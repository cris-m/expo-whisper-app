require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoWhisper'
  s.version        = package['version']
  s.summary        = 'Expo module for whisper.cpp speech recognition'
  s.description    = 'On-device speech recognition using whisper.cpp'
  s.authors        = { 'Expo' => 'support@expo.dev' }
  s.homepage       = 'https://github.com/expo/expo'
  s.license        = { :type => 'MIT', :text => 'MIT License' }
  s.platforms      = { :ios => '13.4' }
  s.source         = { :git => 'https://github.com/expo/expo.git', :tag => "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Only expose iOS wrapper headers publicly
  s.public_header_files = 'ios/*.h'

  # Swift/ObjC sources - include all source files including subdirectories
  # Note: Metal support disabled for now - CPU only
  s.source_files = [
    'ios/**/*.{h,m,mm,swift}',
    'cpp/*.{h,c,cpp}',
    'cpp/ggml-cpu/**/*.{h,c,cpp}'
  ]

  # Keep cpp headers private (not in public headers)
  s.private_header_files = [
    'cpp/**/*.h'
  ]

  # Metal shader files (disabled for now)
  # s.resources = ['cpp/ggml-metal/*.metal']

  # Header search paths for whisper.cpp
  s.preserve_paths = ['cpp/**/*']
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/cpp" "$(PODS_TARGET_SRCROOT)/cpp/ggml-cpu" "$(PODS_TARGET_SRCROOT)/cpp/ggml-cpu/amx" "$(PODS_TARGET_SRCROOT)/cpp/ggml-cpu/llamafile" "$(PODS_TARGET_SRCROOT)/cpp/ggml-cpu/arch" "$(PODS_TARGET_SRCROOT)/cpp/ggml-metal"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) GGML_USE_ACCELERATE=1 GGML_USE_CPU=1 WHISPER_VERSION=\"1.0.0\" GGML_VERSION=\"1.0.0\" GGML_COMMIT=\"local\"',
    'OTHER_CFLAGS' => '-O3 -DNDEBUG -fno-objc-arc',
    'OTHER_CPLUSPLUSFLAGS' => '-O3 -DNDEBUG'
  }

  s.frameworks = 'Accelerate', 'AVFoundation'
  s.library = 'c++'

  s.swift_version = '5.4'
end
