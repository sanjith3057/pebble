/**
 * Reads the foreground window and visible windows on Windows through user32
 * (via koffi, no PowerShell, no hooks, no keylogging).
 *
 * Read-only: it can see a window's title and process name, nothing inside
 * the window, and it never sends input to other apps.
 *
 * Returns null from createWindowsReader() on other platforms or if the native
 * library can't load, so the rest of the app keeps working without it.
 */
function createWindowsReader() {
  if (process.platform !== 'win32') return null;
  let koffi;
  try {
    koffi = require('koffi');
  } catch {
    return null;
  }

  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void* hwnd, intptr_t lParam)');
  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc* cb, intptr_t lParam)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hwnd)');
  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void* hwnd)');
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hwnd, _Out_ uint16_t* text, int max)');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)');
  const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
  const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void* h, uint32_t flags, _Out_ uint16_t* name, _Inout_ uint32_t* size)');
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');

  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const MAX_TITLE = 512;

  function titleOf(hwnd) {
    const length = Math.min(GetWindowTextLengthW(hwnd), MAX_TITLE - 1);
    if (length <= 0) return '';
    const buffer = new Uint16Array(length + 1);
    const n = GetWindowTextW(hwnd, buffer, length + 1);
    return Buffer.from(buffer.buffer, 0, n * 2).toString('utf16le');
  }

  function exeOf(hwnd, cache) {
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    if (cache && cache.has(pid[0])) return cache.get(pid[0]);
    let exe = '';
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
    if (handle) {
      const name = new Uint16Array(1024);
      const size = [1024];
      if (QueryFullProcessImageNameW(handle, 0, name, size)) {
        exe = Buffer.from(name.buffer, 0, size[0] * 2).toString('utf16le').split(/[\\/]/).pop();
      }
      CloseHandle(handle);
    }
    if (cache) cache.set(pid[0], exe);
    return exe;
  }

  return {
    foreground() {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return null;
      return { exe: exeOf(hwnd), title: titleOf(hwnd) };
    },
    windows() {
      const cache = new Map();
      const result = [];
      EnumWindows((hwnd) => {
        if (IsWindowVisible(hwnd) && GetWindowTextLengthW(hwnd) > 0) {
          result.push({ exe: exeOf(hwnd, cache), title: titleOf(hwnd) });
        }
        return true;
      }, 0);
      return result;
    },
  };
}

module.exports = { createWindowsReader };
