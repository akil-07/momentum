import os
import sys
import time
import socket
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

PORT = 8787
HOST = '127.0.0.1'

def is_running():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect((HOST, PORT))
            return True
        except Exception:
            return False

if not is_running():
    py_exe = sys.executable
    if py_exe.lower().endswith('python.exe'):
        candidate = os.path.join(os.path.dirname(py_exe), 'pythonw.exe')
        if os.path.exists(candidate):
            py_exe = candidate

    DETACHED = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    subprocess.Popen(
        [py_exe, 'server.py', '--host', '0.0.0.0'],
        cwd=ROOT,
        creationflags=DETACHED,
        close_fds=True
    )

    for _ in range(50):
        time.sleep(0.1)
        if is_running():
            break

edge_paths = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
chrome_paths = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

browser = None
for p in edge_paths + chrome_paths:
    if os.path.exists(p):
        browser = p
        break

url = f"http://{HOST}:{PORT}"
if browser:
    subprocess.Popen([browser, f"--app={url}"])
else:
    import webbrowser
    webbrowser.open(url)
