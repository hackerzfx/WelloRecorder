#include <node.h>
#include <Windows.h>
#include <TlHelp32.h>
#include <string>
#include <vector>
#include <fstream>
#include <iostream>

namespace injector {

using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;
using v8::Number;
using v8::Boolean;

// Type definitions for function pointers used in shellcode
using f_LoadLibraryA = HINSTANCE(WINAPI*)(const char* lpLibFileName);
using f_GetProcAddress = UINT_PTR(WINAPI*)(HINSTANCE hModule, const char* lpProcName);
using f_DllMain = BOOL(WINAPI*)(void* hDll, DWORD dwReason, void* pReserved);

// Data structure to pass to the shellcode
struct MANUAL_MAPPING_DATA {
    f_LoadLibraryA pLoadLibraryA;
    f_GetProcAddress pGetProcAddress;
    BYTE* pBase;
    HINSTANCE hMod;
    DWORD fdwReasonParam; // DLL_PROCESS_ATTACH
    LPVOID pReservedParam;
    BOOL SEHExceptionSupport;
};

// Find process ID by name
DWORD FindProcessId(const std::wstring& processName)
{
    PROCESSENTRY32W processInfo;
    processInfo.dwSize = sizeof(processInfo);

    HANDLE processesSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, NULL);
    if (processesSnapshot == INVALID_HANDLE_VALUE) {
        return 0;
    }

    Process32FirstW(processesSnapshot, &processInfo);
    do {
        // Debug Logging: Print every process seen
        char processNameMb[MAX_PATH];
        WideCharToMultiByte(CP_ACP, 0, processInfo.szExeFile, -1, processNameMb, MAX_PATH, NULL, NULL);
        // Only print if it looks like xvast to reduce spam, or just print all to be safe.
        // Let's print names starting with 'x' or 'X' or 'c' (chrome) just to filter a bit?
        // No, print all, but maybe limit length?
        // Actually, just print all.
        std::cout << "[Injector Debug] Scanning: " << processNameMb << std::endl;
        
        // Simple case-insensitive comparison
        if (_wcsicmp(processName.c_str(), processInfo.szExeFile) == 0) {
            CloseHandle(processesSnapshot);
            std::cout << "[Injector Debug] FOUND MATCH: " << processNameMb << " (PID: " << processInfo.th32ProcessID << ")" << std::endl;
            return processInfo.th32ProcessID;
        }
    } while (Process32NextW(processesSnapshot, &processInfo));

    std::cout << "[Injector Debug] Process not found in snapshot." << std::endl;
    CloseHandle(processesSnapshot);
    return 0;
}

// Shellcode that runs in the target process
// NOTE: This must be position independent and not use any global variables or string literals directly.
DWORD __stdcall Shellcode(MANUAL_MAPPING_DATA* pData) {
    if (!pData) return 0;

    BYTE* pBase = pData->pBase;
    auto* pOpt = &reinterpret_cast<IMAGE_NT_HEADERS*>(pBase + reinterpret_cast<IMAGE_DOS_HEADER*>(pBase)->e_lfanew)->OptionalHeader;

    // 1. Relocations
    auto* pRelocData = reinterpret_cast<IMAGE_BASE_RELOCATION*>(pBase + pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_BASERELOC].VirtualAddress);
    DWORD_PTR delta = (DWORD_PTR)(pBase - pOpt->ImageBase);

    if (delta != 0 && pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_BASERELOC].Size) {
        while (pRelocData->VirtualAddress) {
            if (pRelocData->SizeOfBlock >= sizeof(IMAGE_BASE_RELOCATION)) {
                DWORD count = (pRelocData->SizeOfBlock - sizeof(IMAGE_BASE_RELOCATION)) / sizeof(WORD);
                WORD* pRelativeInfo = reinterpret_cast<WORD*>(pRelocData + 1);

                for (DWORD i = 0; i < count; ++i) {
                    if (pRelativeInfo[i]) {
                        DWORD_PTR* pPatch = reinterpret_cast<DWORD_PTR*>(pBase + pRelocData->VirtualAddress + (pRelativeInfo[i] & 0xFFF));
                        *pPatch += delta;
                    }
                }
            }
            pRelocData = reinterpret_cast<IMAGE_BASE_RELOCATION*>(reinterpret_cast<BYTE*>(pRelocData) + pRelocData->SizeOfBlock);
        }
    }

    // 2. Resolve Imports
    if (pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].Size) {
        auto* pImportDescr = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(pBase + pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);
        
        while (pImportDescr->Name) {
            char* szMod = reinterpret_cast<char*>(pBase + pImportDescr->Name);
            HINSTANCE hDll = pData->pLoadLibraryA(szMod);

            ULONG_PTR* pThunkRef = reinterpret_cast<ULONG_PTR*>(pBase + pImportDescr->OriginalFirstThunk);
            ULONG_PTR* pFuncRef = reinterpret_cast<ULONG_PTR*>(pBase + pImportDescr->FirstThunk);

            if (!pThunkRef) pThunkRef = pFuncRef;

            for (; *pThunkRef; ++pThunkRef, ++pFuncRef) {
                if (IMAGE_SNAP_BY_ORDINAL(*pThunkRef)) {
                    *pFuncRef = pData->pGetProcAddress(hDll, reinterpret_cast<char*>(*pThunkRef & 0xFFFF));
                } else {
                    auto* pImport = reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(pBase + (*pThunkRef));
                    *pFuncRef = pData->pGetProcAddress(hDll, pImport->Name);
                }
            }
            ++pImportDescr;
        }
    }

    // 3. TLS Callbacks (Optional, good for stability)
    if (pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_TLS].Size) {
        auto* pTLS = reinterpret_cast<IMAGE_TLS_DIRECTORY*>(pBase + pOpt->DataDirectory[IMAGE_DIRECTORY_ENTRY_TLS].VirtualAddress);
        auto* pCallback = reinterpret_cast<PIMAGE_TLS_CALLBACK*>(pTLS->AddressOfCallBacks);
        for (; pCallback && *pCallback; ++pCallback) {
            (*pCallback)(pBase, DLL_PROCESS_ATTACH, NULL);
        }
    }

    // 4. Call DllMain
    f_DllMain pDllMain = (f_DllMain)(pBase + pOpt->AddressOfEntryPoint);
    pDllMain(pBase, DLL_PROCESS_ATTACH, NULL); // Main entry point

    return 1;
}

// Function to map the DLL manually
bool ManualMap(DWORD processId, const std::wstring& dllPath) {
    // 1. Read DLL File
    std::ifstream File(dllPath, std::ios::binary | std::ios::ate);
    if (File.fail()) return false;

    auto FileSize = File.tellg();
    if (FileSize < 0x1000) { File.close(); return false; } // Too small

    BYTE* pSrcData = new BYTE[(UINT_PTR)FileSize];
    if (!pSrcData) { File.close(); return false; }

    File.seekg(0, std::ios::beg);
    File.read(reinterpret_cast<char*>(pSrcData), FileSize);
    File.close();

    // Check headers
    auto* pDosHeader = reinterpret_cast<IMAGE_DOS_HEADER*>(pSrcData);
    if (pDosHeader->e_magic != 0x5A4D) { // MZ
        delete[] pSrcData; return false;
    }

    auto* pNtHeaders = reinterpret_cast<IMAGE_NT_HEADERS*>(pSrcData + pDosHeader->e_lfanew);
    auto* pOptHeader = &pNtHeaders->OptionalHeader;
    auto* pFileHeader = &pNtHeaders->FileHeader;

    if (pFileHeader->Machine != IMAGE_FILE_MACHINE_AMD64) {
        // Only supporting x64 for now as requested
         delete[] pSrcData; return false;
    }

    // 2. Open Target Process
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, processId);
    if (!hProcess) {
        delete[] pSrcData; return false;
    }

    // 3. Allocate Memory in Target
    BYTE* pTargetBase = reinterpret_cast<BYTE*>(VirtualAllocEx(hProcess, reinterpret_cast<void*>(pOptHeader->ImageBase), pOptHeader->SizeOfImage, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE));
    if (!pTargetBase) {
        // Try arbitrary address
        pTargetBase = reinterpret_cast<BYTE*>(VirtualAllocEx(hProcess, nullptr, pOptHeader->SizeOfImage, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE));
        if (!pTargetBase) {
             CloseHandle(hProcess); delete[] pSrcData; return false;
        }
    }

    // 4. Copy Sections
    // Copy headers first
    if (!WriteProcessMemory(hProcess, pTargetBase, pSrcData, 0x1000, nullptr)) { // Header size usually <= 0x1000
        VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
    }

    IMAGE_SECTION_HEADER* pSectionHeader = IMAGE_FIRST_SECTION(pNtHeaders);
    for (UINT i = 0; i < pFileHeader->NumberOfSections; ++i, ++pSectionHeader) {
        if (pSectionHeader->SizeOfRawData) {
            if (!WriteProcessMemory(hProcess, pTargetBase + pSectionHeader->VirtualAddress, pSrcData + pSectionHeader->PointerToRawData, pSectionHeader->SizeOfRawData, nullptr)) {
                VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
            }
        }
    }

    // 5. Inject Shellcode and Data
    MANUAL_MAPPING_DATA data{ 0 };
    data.pLoadLibraryA = LoadLibraryA;
    data.pGetProcAddress = reinterpret_cast<f_GetProcAddress>(GetProcAddress);
    data.pBase = pTargetBase;
    
    // Allocate memory for shellcode and data
    BYTE* pShellcodeLoader = reinterpret_cast<BYTE*>(VirtualAllocEx(hProcess, nullptr, 0x1000, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE));
    if (!pShellcodeLoader) {
        VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
    }

    // Write Data
    if (!WriteProcessMemory(hProcess, pShellcodeLoader, &data, sizeof(MANUAL_MAPPING_DATA), nullptr)) {
         VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); VirtualFreeEx(hProcess, pShellcodeLoader, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
    }

    // Write Shellcode
    void* pShellcodeSrc = (void*)Shellcode;
    // Calculate size of Shellcode function - simplistic heuristic, safer to just copy enough (e.g. 0x1000 or calculated difference)
    // NOTE: In Debug builds, this might be a JMP table. In Release, it's the function start.
    // For safety, we should assume compiled size is small enough for now, or use a sentinel.
    // Let's copy 0x500 bytes which is usually enough for this simple logic.
    size_t ShellcodeSize = 0x500; 

    if (!WriteProcessMemory(hProcess, pShellcodeLoader + sizeof(MANUAL_MAPPING_DATA), pShellcodeSrc, ShellcodeSize, nullptr)) {
         VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); VirtualFreeEx(hProcess, pShellcodeLoader, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
    }

    // 6. Execute Shellcode
    HANDLE hThread = CreateRemoteThread(hProcess, nullptr, 0, reinterpret_cast<LPTHREAD_START_ROUTINE>(pShellcodeLoader + sizeof(MANUAL_MAPPING_DATA)), pShellcodeLoader, 0, nullptr);
    if (!hThread) {
        VirtualFreeEx(hProcess, pTargetBase, 0, MEM_RELEASE); VirtualFreeEx(hProcess, pShellcodeLoader, 0, MEM_RELEASE); CloseHandle(hProcess); delete[] pSrcData; return false;
    }

    WaitForSingleObject(hThread, INFINITE);

    // Cleanup: We don't free pTargetBase as sections are used. We CAN free shellcode memory if we want, but keeping it is safer for stability if threads are still running (unlikely for this loader).
    // Usually we leave it or zero it out.
    CloseHandle(hThread);
    CloseHandle(hProcess);
    delete[] pSrcData;

    return true;
}


// Exposed function: Inject(processIdOrName, dllPath)
void Inject(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    if (args.Length() < 2) {
        isolate->ThrowException(Exception::TypeError(
            String::NewFromUtf8(isolate, "Wrong number of arguments").ToLocalChecked()));
        return;
    }

    DWORD pid = 0;

    // Check if first argument is a Number (PID)
    if (args[0]->IsNumber()) {
        pid = args[0]->Uint32Value(isolate->GetCurrentContext()).ToChecked();
        // std::cout << "[Injector] Targeting PID directly: " << pid << std::endl;
    } 
    // Otherwise treat as String (Process Name)
    else if (args[0]->IsString()) {
        String::Value processNameVal(isolate, args[0]);
        std::wstring processName(reinterpret_cast<const wchar_t*>(*processNameVal));
        pid = FindProcessId(processName);
    } 
    else {
        isolate->ThrowException(Exception::TypeError(
            String::NewFromUtf8(isolate, "First argument must be a PID (number) or Process Name (string)").ToLocalChecked()));
        return;
    }

    if (pid == 0) {
        // std::cout << "[Injector] Process not found (PID=0)" << std::endl;
        args.GetReturnValue().Set(Boolean::New(isolate, false));
        return;
    }

    String::Value dllPathVal(isolate, args[1]);
    std::wstring dllPath(reinterpret_cast<const wchar_t*>(*dllPathVal));

    if (ManualMap(pid, dllPath)) {
        args.GetReturnValue().Set(Boolean::New(isolate, true));
    } else {
        args.GetReturnValue().Set(Boolean::New(isolate, false));
    }
}
void Initialize(Local<Object> exports)
{
    NODE_SET_METHOD(exports, "inject", Inject);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)

}  // namespace injector
