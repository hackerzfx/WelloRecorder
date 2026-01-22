# Wello DRM Bypass - Build Instructions

This directory contains the DLL injection system for bypassing SetWindowDisplayAffinity in XVast.

## Prerequisites

1. **Visual Studio 2022** (with "Desktop development with C++" workload)
   - Download: https://visualstudio.microsoft.com/downloads/
   - Select "Desktop development with C++" during installation

2. **CMake** (3.15 or higher)
   - Download: https://cmake.org/download/
   - Add to PATH during installation

3. **Python 3.x** (required by node-gyp)
   - Download: https://www.python.org/downloads/
   - Check "Add Python to PATH" during installation

4. **node-gyp** (globally installed)
   ```powershell
   npm install -g node-gyp
   ```

## Quick Build (Automated)

Run the build script from the project root:

```powershell
.\build-drm-bypass.ps1
```

This will automatically build both the hook DLL and the injector addon.

## Manual Build Instructions

### Step 1: Build Hook DLL

```powershell
cd hook_dll
mkdir build
cd build
cmake .. -G "Visual Studio 17 2022" -A x64
cmake --build . --config Release
```

The output will be at: `hook_dll/build/bin/Release/wello_hook.dll`

Copy it to the project root:
```powershell
copy hook_dll\build\bin\Release\wello_hook.dll .
```

### Step 2: Build Injector Addon

```powershell
cd injector
npm install
node-gyp configure --msvs_version=2022
node-gyp build --release
```

The output will be at: `injector/build/Release/injector.node`

## Verification

After building, verify these files exist:

- ✅ `wello_hook.dll` (in project root)
- ✅ `injector/build/Release/injector.node`
- ✅ `minhook/` (cloned repository)

## Testing

1. Run Wello: `npm start`
2. Check console for: `[Wello] DLL injector loaded successfully`
3. Launch XVast from the browser list
4. Check console for: `[Wello] ✓ Successfully injected DRM bypass hook into XVast!`
5. Start recording - you should see XVast content (not black screen)

## Troubleshooting

### "Hook DLL not found"
- Make sure `wello_hook.dll` is copied to the project root
- Check the file path in the error message

### "DLL injector not available"
- The injector addon failed to build
- Run `cd injector && node-gyp rebuild` manually
- Check for Visual Studio C++ tools installation

### "Process not found"
- XVast might not be running yet
- Increase the timeout in main.js (currently 3000ms)

### "Failed to inject hook"
- Run Wello as Administrator (right-click → Run as administrator)
- XVast might have anti-debugging protection enabled
- Check antivirus isn't blocking the injection

### Antivirus Warnings
- DLL injection is detected as suspicious by many antivirus programs
- Add exception for:
  - `wello_hook.dll`
  - `injector.node`
  - The entire Wello directory

## Security Notice

⚠️ **This implementation injects code into another process**. While used here for legitimate screen recording purposes, DLL injection techniques can be flagged by security software.

**Legal Disclaimer**: Only use this for recording content you have permission to record. Bypassing DRM may violate content provider terms of service.

## Architecture

```
Wello (Electron)
    ↓
injector.node (Node.js addon)
    ↓ CreateRemoteThread
XVast (chrome.exe)
    ↓ LoadLibrary
wello_hook.dll
    ↓ MinHook
SetWindowDisplayAffinity → Hooked (returns TRUE without setting protection)
```

## Cleaning Build Files

To clean and rebuild everything:

```powershell
# Clean hook DLL
Remove-Item -Recurse -Force hook_dll\build

# Clean injector
Remove-Item -Recurse -Force injector\build
Remove-Item -Recurse -Force injector\node_modules

# Remove outputs
Remove-Item wello_hook.dll

# Rebuild
.\build-drm-bypass.ps1
```
