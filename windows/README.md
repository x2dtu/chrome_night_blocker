# Windows: grayscale at night

Turns on the Windows **grayscale** color filter during a nightly window (default 11:30 PM –
8:00 AM) and off again in the morning. A grey screen makes scrolling a lot less appealing.
Free, no admin rights needed, Windows 10 and 11.

## Set up (once)

1. **Settings → Ease of Access → Color filters** (Windows 11: **Accessibility → Color filters**):
   turn on **"Allow the shortcut key to toggle filter on or off"**. Leave the filter itself off.
   Check that **Win + Ctrl + C** now switches grayscale on and off, then leave it off.
2. Copy this `windows` folder to the laptop, open it in File Explorer, click the address bar,
   type `powershell` and press Enter.
3. Install with your times (24-hour clock):

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Start 23:30 -End 08:00
   ```

   Only some nights? Add e.g. `-Days Sun,Mon,Tue,Wed,Thu` (the days the window *starts* on).
   Run `install.ps1` again any time to change the times.

It switches right away if you're inside the window. After that it runs at the start and end
times, and also when you sign in, unlock, or the laptop wakes — so it catches up if the laptop
was asleep or off at switch-over time.

## Check / try it

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\NightBlocker\grayscale.ps1" -Mode Status
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\NightBlocker\grayscale.ps1" -Mode On
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\NightBlocker\grayscale.ps1" -Mode Off
```

What it did is logged in `%LOCALAPPDATA%\NightBlocker\grayscale.log`. The task is
**Night Blocker Grayscale** in Task Scheduler (Task Scheduler Library); right-click → Run to run
it now.

## How it works

Windows stores the filter in `HKCU\Software\Microsoft\ColorFiltering` (`Active`, `FilterType`
0 = grayscale), but changing those values only applies after signing out. The script reads them
to see whether grayscale is on, and only if it's in the wrong state presses Win + Ctrl + C for
you — so it never flips the wrong way. If the screen is locked it waits for the unlock.

## Limits

- It's a nudge, not a lock: Win + Ctrl + C still turns grayscale off by hand (until the next
  sign-in, unlock or wake puts it back on).
- A console window may flash briefly when the task runs.
- It only works while you're signed in (the shortcut is pressed in your session).

## Remove

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```
