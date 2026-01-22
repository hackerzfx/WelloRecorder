#include <Windows.h>
#include "../minhook/include/MinHook.h"
#include <stdio.h>

// Function pointer for the original SetWindowDisplayAffinity
typedef BOOL (WINAPI *SetWindowDisplayAffinity_t)(HWND, DWORD);
SetWindowDisplayAffinity_t g_pOriginalSetWindowDisplayAffinity = NULL;

// Our hooked function - intercepts calls and returns success without setting affinity
BOOL WINAPI HookedSetWindowDisplayAffinity(HWND hWnd, DWORD dwAffinity)
{
    // Log the interception (optional, for debugging)
    OutputDebugStringA("[Wello Hook] SetWindowDisplayAffinity intercepted!");
    
    // CRITICAL: Do NOT call the original function
    // Just return TRUE to make XVast think the protection was set successfully
    return TRUE;
}

// DLL Entry Point
BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved)
{
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:
    {
        // Disable DLL_THREAD_ATTACH and DLL_THREAD_DETACH notifications (performance)
        DisableThreadLibraryCalls(hModule);

        // Initialize MinHook
        if (MH_Initialize() != MH_OK)
        {
            OutputDebugStringA("[Wello Hook] Failed to initialize MinHook!");
            return FALSE;
        }

        // Create a hook for SetWindowDisplayAffinity
        if (MH_CreateHook(&SetWindowDisplayAffinity,
                          &HookedSetWindowDisplayAffinity,
                          reinterpret_cast<LPVOID*>(&g_pOriginalSetWindowDisplayAffinity)) != MH_OK)
        {
            OutputDebugStringA("[Wello Hook] Failed to create hook!");
            return FALSE;
        }

        // Enable the hook
        if (MH_EnableHook(&SetWindowDisplayAffinity) != MH_OK)
        {
            OutputDebugStringA("[Wello Hook] Failed to enable hook!");
            return FALSE;
        }

        OutputDebugStringA("[Wello Hook] Successfully hooked SetWindowDisplayAffinity!");
        break;
    }
    case DLL_PROCESS_DETACH:
    {
        // Disable the hook
        MH_DisableHook(&SetWindowDisplayAffinity);
        
        // Uninitialize MinHook
        MH_Uninitialize();
        
        OutputDebugStringA("[Wello Hook] Hook removed.");
        break;
    }
    }
    return TRUE;
}
