# Debugging Checklist for Silver Issues

## How to Apply the Fixes

1. **Pull the latest changes:**
   ```bash
   git pull origin claude/silver-ai-contextual-layer-011CV5FUyUZuFQ17Rv6wZBzg
   ```

2. **Rebuild the application:**
   ```bash
   npm run build
   npm run electron:dev
   ```

3. **Check the console for logs** - All fixes include extensive logging

## Issue 1: Setup Window Going to Background

**What was fixed (electron/main.ts:877-889):**
- Added `alwaysOnTop: true`
- Added `center: true`
- Added `show: false` with `ready-to-show` event handler

**How to test:**
1. Delete the setup flag file (location varies by OS)
2. Restart the application
3. Setup window should appear on top and stay on top

**Expected logs:**
- Look for setup window creation logs in console

**If still not working, check:**
- Is the setup window being created at all?
- Does the console show any errors?
- What OS are you on?

## Issue 2: Images Not Loading in Chat

**What was fixed:**
1. **electron/main.ts (lines 541-595):** Added comprehensive logging throughout `captureScreen()`
2. **electron/main.ts (lines 740-753):** Added logging before IPC send
3. **ChatWindow.tsx (lines 37-59):** Simplified image handling - images are now pre-cropped by main process

**How to test:**
1. Press Cmd/Ctrl+Shift+S
2. Select a region
3. Check console logs

**Expected logs:**
```
captureScreen: Starting capture with bounds: {x, y, width, height}
captureScreen: Display size: {width, height}
captureScreen: Calling desktopCapturer.getSources...
captureScreen: Got X sources
captureScreen: Using source: Screen X
captureScreen: Native image size: {width, height}
captureScreen: Converted to data URL, length: XXXXX
captureScreen: Result JSON length: XXXXX
=== Sending image to chat window ===
Image data length: XXXXX
ChatWindow: Received image from main process, data length: XXXXX
ChatWindow: Image set, length: XXXXX
```

**If images still not loading:**
- Share the console logs
- Does the image data have a length > 0?
- Is the IPC message reaching ChatWindow?

## Issue 3: Annotation Not Working

**What was fixed (ChatWindow.tsx:340-346):**
- Changed to pass `imageDataUrl` (cropped image) instead of `baseImage` (raw JSON)
- Updated annotate button to be disabled until `imageDataUrl` is available

**Dependencies:**
- This fix depends on Issue 2 being fixed (images loading)

**How to test:**
1. Capture a region (images must load first)
2. Click "Annotate (Pro)" button
3. Should see annotation canvas with the cropped image

**Expected logs:**
```
AnnotationCanvas: useEffect triggered, baseImage length: XXXXX
AnnotationCanvas: canvasRef available
AnnotationCanvas: Not JSON, using baseImage as-is
AnnotationCanvas: Setting img.src, length: XXXXX
AnnotationCanvas: Image loaded successfully, size: X x Y
AnnotationCanvas: Image drawn to canvas
```

**If annotation still not working:**
- Is the Annotate button enabled?
- Share the AnnotationCanvas console logs
- Does the image load in chat first?

## Console Access

**To see logs:**
- **In development:** Check the terminal where you ran `npm run electron:dev`
- **In production build:** Open Developer Tools in the Electron app
  - macOS: Cmd+Option+I
  - Windows: Ctrl+Shift+I

## Share This Info If Issues Persist

1. **Console logs** - Copy ALL console output
2. **Steps you're taking** - Exact sequence of actions
3. **What you see** - Describe the visible behavior
4. **OS and version** - macOS/Windows version
5. **Screenshots** - If possible, screenshot the issue

## Quick Test Script

Run this to verify the build is correct:

```bash
# 1. Pull latest
git pull origin claude/silver-ai-contextual-layer-011CV5FUyUZuFQ17Rv6wZBzg

# 2. Check the fixes are in the code
grep -n "alwaysOnTop: true" electron/main.ts | grep 877
grep -n "captureScreen: Starting capture" electron/main.ts | grep 541
grep -n "imageDataUrl" src/components/ChatWindow.tsx | grep 340

# 3. If all above show results, rebuild
npm run build
npm run electron:dev
```
