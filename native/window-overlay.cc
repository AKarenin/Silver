#include <napi.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

// Native module to set NSWindow collection behavior
// This allows the window to appear over fullscreen apps like Raycast does

Napi::Value SetWindowCollectionBehavior(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected 2 arguments: windowId and behavior")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Electron's getNativeWindowHandle returns a Buffer with window ID
  // We need to find the NSWindow by iterating through all windows
  uint32_t windowId = info[0].As<Napi::Number>().Uint32Value();
  unsigned long behavior = info[1].As<Napi::Number>().Uint32Value();
  
  @autoreleasepool {
    // Find the window by iterating through all application windows
    NSArray* windows = [[NSApplication sharedApplication] windows];
    for (NSWindow* window in windows) {
      // Check if this is the window we're looking for
      // We'll match by checking if the window's contentView matches
      if (window && [window windowNumber] == windowId) {
        [window setCollectionBehavior:behavior];
        return Napi::Boolean::New(env, true);
      }
    }
    
    // Alternative: Try to get window by ID directly
    NSWindow* targetWindow = [[NSApplication sharedApplication] windowWithWindowNumber:windowId];
    if (targetWindow) {
      [targetWindow setCollectionBehavior:behavior];
      return Napi::Boolean::New(env, true);
    }
  }
  
  return Napi::Boolean::New(env, false);
}

// Alternative: Get NSWindow from BrowserWindow's native handle
Napi::Value GetNSWindowFromHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1) {
    return env.Null();
  }
  
  // Electron's native window handle is a Buffer
  // We need to extract the window pointer from it
  Napi::Buffer<void> buffer = info[0].As<Napi::Buffer<void>>();
  void* ptr = buffer.Data();
  
  @autoreleasepool {
    // The buffer contains a pointer to NSWindow
    NSWindow* window = *((NSWindow**)ptr);
    if (window) {
      // Return window number as identifier
      return Napi::Number::New(env, [window windowNumber]);
    }
  }
  
  return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(
    Napi::String::New(env, "setWindowCollectionBehavior"),
    Napi::Function::New(env, SetWindowCollectionBehavior)
  );
  exports.Set(
    Napi::String::New(env, "getNSWindowFromHandle"),
    Napi::Function::New(env, GetNSWindowFromHandle)
  );
  return exports;
}

NODE_API_MODULE(window_overlay, Init)

