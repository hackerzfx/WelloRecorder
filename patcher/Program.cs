using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.IO;
using System.Linq;
using System.Collections.Generic;

namespace XVastPatcher
{
    class Program
    {
        // Constants
        const int PROCESS_VM_WRITE = 0x0020;
        const int PROCESS_VM_OPERATION = 0x0008;
        const int PROCESS_VM_READ = 0x0010;
        const int PROCESS_QUERY_INFORMATION = 0x0400;
        const uint PAGE_EXECUTE_READWRITE = 0x40;

        [DllImport("kernel32.dll")]
        public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int nSize, out int lpNumberOfBytesWritten);

        [DllImport("kernel32.dll")]
        public static extern bool VirtualProtectEx(IntPtr hProcess, IntPtr lpAddress, UIntPtr dwSize, uint flNewProtect, out uint lpflOldProtect);

        [DllImport("kernel32.dll")]
        public static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr hObject);

        static void Main(string[] args)
        {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("========================================");
            Console.WriteLine("   XVast Patcher v5 (DEBUG MODE)        ");
            Console.WriteLine("========================================");
            Console.ResetColor();

            Console.WriteLine("1. Calculating offsets...");
            IntPtr localUser32 = GetModuleHandle("user32.dll");
            IntPtr localFunc = GetProcAddress(localUser32, "SetWindowDisplayAffinity");
            int funcOffset = (int)((long)localFunc - (long)localUser32);
            Console.WriteLine("   Offset found: 0x" + funcOffset.ToString("X"));

            Console.WriteLine("2. Scanning processes...");

            HashSet<int> patchedPids = new HashSet<int>();

            while (true)
            {
                var processes = Process.GetProcesses();
                foreach (var p in processes)
                {
                    try
                    {
                        string pName = p.ProcessName.ToLower();
                        if (pName.Contains("chrome") || pName.Contains("xvast"))
                        {
                            Console.WriteLine("   -> Found candidate: " + p.ProcessName + " (PID: " + p.Id + ")");
                            
                            string path = "";
                            try { path = p.MainModule.FileName; } catch { path = "ACCESS DENIED"; }
                            
                            string title = "";
                            try { title = p.MainWindowTitle; } catch { title = "ACCESS DENIED"; }

                            Console.WriteLine("      Path: " + path);
                            Console.WriteLine("      Title: " + title);

                            bool isTarget = false;

                            // RELAXED FILTER: 
                            // Check Path OR Title
                            if ((!path.Equals("ACCESS DENIED") && path.ToLower().Contains("xvast")) || 
                                (!title.Equals("ACCESS DENIED") && title.ToLower().Contains("xvast")))
                            {
                                isTarget = true;
                            }
                            else
                            {
                                Console.WriteLine("      [SKIP] neither Path nor Title matched 'Xvast'");
                            }

                            if (patchedPids.Contains(p.Id)) isTarget = false;

                            if (isTarget)
                            {
                                Console.WriteLine("      [MATCH] Attempting patch...");

                                // Find Remote Module Base
                                IntPtr targetAddress = IntPtr.Zero;

                                try 
                                {
                                    // Strategy 1: Try to find module (might fail with Access Denied)
                                    foreach (ProcessModule mod in p.Modules)
                                    {
                                        if (mod.ModuleName.Equals("user32.dll", StringComparison.OrdinalIgnoreCase))
                                        {
                                            IntPtr remoteBase = mod.BaseAddress;
                                            targetAddress = (IntPtr)((long)remoteBase + funcOffset);
                                            Console.WriteLine("      [INFO] Found remote user32.dll at 0x" + remoteBase.ToString("X"));
                                            break;
                                        }
                                    }
                                }
                                catch (Exception ex)
                                {
                                    Console.WriteLine("      [WARN] Could not enumerate modules: " + ex.Message);
                                }

                                // Strategy 2: Fallback to Local Address (Shared DLL Assumption)
                                if (targetAddress == IntPtr.Zero)
                                {
                                    Console.WriteLine("      [INFO] Fallback: Using Local Address (Shared DLL mapping)");
                                    targetAddress = localFunc;
                                }

                                Console.WriteLine("      Target Address: 0x" + targetAddress.ToString("X"));

                                if (PatchProcess(p.Id, targetAddress))
                                {
                                    patchedPids.Add(p.Id);
                                    Console.ForegroundColor = ConsoleColor.Green;
                                    Console.WriteLine("      [SUCCESS] Patch Applied!");
                                    Console.ResetColor();
                                }
                                else
                                {
                                     Console.ForegroundColor = ConsoleColor.Red;
                                     Console.WriteLine("      [FAIL] Patch Failed - OpenProcess or Write failed.");
                                     Console.ResetColor();
                                }
                            }
                        }
                    }
                    catch { }
                }
                Thread.Sleep(2000);
            }
        }

        static bool PatchProcess(int pid, IntPtr address)
        {
            IntPtr hProcess = OpenProcess(PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
            if (hProcess != IntPtr.Zero)
            {
                uint oldProtect;
                if (VirtualProtectEx(hProcess, address, (UIntPtr)8, PAGE_EXECUTE_READWRITE, out oldProtect))
                {
                    // x64 Assembly: MOV RAX, 1; RET
                    // 48 C7 C0 01 00 00 00 C3
                    byte[] patch = { 0x48, 0xC7, 0xC0, 0x01, 0x00, 0x00, 0x00, 0xC3 };
                    int bytesWritten = 0;
                    bool success = WriteProcessMemory(hProcess, address, patch, patch.Length, out bytesWritten);
                    
                    VirtualProtectEx(hProcess, address, (UIntPtr)8, oldProtect, out oldProtect);
                    CloseHandle(hProcess);
                    return success;
                }
                CloseHandle(hProcess);
            }
            return false;
        }
    }
}
