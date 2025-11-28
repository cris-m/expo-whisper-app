cmake_minimum_required(VERSION 3.22.1)

project(whisper)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Optimization flags
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -DNDEBUG")

# Path to whisper.cpp sources
set(WHISPER_CPP_DIR "${CMAKE_SOURCE_DIR}/../../../../cpp")

# Include directories
include_directories(
    ${WHISPER_CPP_DIR}
    ${WHISPER_CPP_DIR}/ggml-cpu
)

# Collect whisper source files
set(WHISPER_SOURCES
    ${WHISPER_CPP_DIR}/whisper.cpp
    ${WHISPER_CPP_DIR}/ggml.c
    ${WHISPER_CPP_DIR}/ggml.cpp
    ${WHISPER_CPP_DIR}/ggml-alloc.c
    ${WHISPER_CPP_DIR}/ggml-backend.cpp
    ${WHISPER_CPP_DIR}/ggml-backend-reg.cpp
    ${WHISPER_CPP_DIR}/ggml-quants.c
    ${WHISPER_CPP_DIR}/ggml-threading.cpp
    ${WHISPER_CPP_DIR}/ggml-opt.cpp
    ${WHISPER_CPP_DIR}/gguf.cpp
)

# Add ggml-cpu sources
file(GLOB GGML_CPU_SOURCES "${WHISPER_CPP_DIR}/ggml-cpu/*.cpp" "${WHISPER_CPP_DIR}/ggml-cpu/*.c")
list(APPEND WHISPER_SOURCES ${GGML_CPU_SOURCES})

# JNI bridge
set(JNI_SOURCES
    whisper_jni.cpp
)

# Create shared library
add_library(whisper SHARED
    ${WHISPER_SOURCES}
    ${JNI_SOURCES}
)

# Link libraries
target_link_libraries(whisper
    android
    log
)

# Preprocessor definitions
target_compile_definitions(whisper PRIVATE
    GGML_USE_CPU=1
)
