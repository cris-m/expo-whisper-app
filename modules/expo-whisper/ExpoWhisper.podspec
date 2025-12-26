Pod::Spec.new do |s|
  s.name           = 'ExpoWhisper'
  s.version        = '1.0.0'
  s.summary        = 'On-device speech-to-text using whisper.cpp for Expo/React Native'
  s.description    = <<-DESC
    ExpoWhisper provides on-device speech-to-text transcription using whisper.cpp,
    enabling real-time audio transcription without cloud dependency.
  DESC
  s.homepage       = 'https://github.com/whisperapp/expo-whisper'
  s.license        = { :type => 'MIT', :text => 'MIT License' }
  s.author         = { 'Whisper App' => 'dev@whisperapp.com' }

  s.platform       = :ios, '14.0'
  s.source         = { :path => '.' }
  s.static_framework = true

  # Include all C++ sources and headers with subdirectories
  s.source_files = [
    'ios/src/**/*.{h,swift,mm,m}',
    'cpp/**/*.{c,cpp,h}'
  ]

  # Only expose iOS wrapper headers publicly
  s.public_header_files = [
    'ios/src/**/*.h'
  ]

  # Keep cpp headers private
  s.private_header_files = [
    'cpp/**/*.h'
  ]

  s.frameworks = [
    'Foundation',
    'AVFoundation',
    'Accelerate'
  ]

  s.weak_frameworks = ['CoreML']

  s.requires_arc = true
  s.swift_version = '5.9'

  # Preserve C++ source paths for proper compilation
  s.preserve_paths = ['cpp/**/*']

  # Comprehensive compiler flags for C++ and GGML compilation
  # Based on proven working configurations from xexpo-whisper and whisper.rn projects
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/cpp" "$(PODS_TARGET_SRCROOT)/cpp/ggml-cpu" "$(PODS_TARGET_SRCROOT)/cpp/ggml-metal"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) GGML_USE_ACCELERATE=1 GGML_USE_CPU=1 WHISPER_VERSION=\"1.0.0\" DWSP_GGML_USE_CPU DWSP_GGML_USE_ACCELERATE',
    'OTHER_CFLAGS' => '-O3 -DNDEBUG -fno-finite-math-only -pthread -Wno-shorten-64-to-32 -fvisibility=hidden -ffunction-sections -fdata-sections',
    'OTHER_CPLUSPLUSFLAGS' => '-O3 -DNDEBUG -fno-finite-math-only -std=c++17 -pthread -Wno-shorten-64-to-32 -fvisibility=hidden -fvisibility-inlines-hidden -ffunction-sections -fdata-sections',
    'IPHONEOS_DEPLOYMENT_TARGET' => '14.0'
  }

  s.prefix_header_contents = <<~'EOS'
    #ifdef __OBJC__
    #import <React/RCTAssert.h>
    #endif

    /* Disable the __FINITE_MATH_ONLY__ error for ggml compatibility */
    #pragma clang diagnostic ignored "-Werror"
    #pragma clang diagnostic ignored "-W#error-directive"
  EOS

  s.user_target_xcconfig = {
    'IPHONEOS_DEPLOYMENT_TARGET' => '14.0'
  }

  s.library = 'c++'

  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'
end
