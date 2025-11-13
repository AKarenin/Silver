{
  "targets": [
    {
      "target_name": "window-overlay",
      "sources": [ "window-overlay.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.13"
      },
      "conditions": [
        ["OS=='mac'", {
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "frameworks": [ "AppKit", "Cocoa" ]
        }]
      ]
    }
  ]
}

