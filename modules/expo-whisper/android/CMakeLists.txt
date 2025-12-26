cmake_minimum_required(VERSION 3.10.2)

project(whisper-jni)

# Define source location for whisper.cpp (assuming it's in ../cpp relative to this file's parent dir)
# We need to go up from android (current CMAKE dir) to cpp directory
get_filename_component(ROOT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/.. ABSOLUTE)
set(CPP_DIR ${ROOT_DIR}/cpp)

# Include directories
include_directories(${CPP_DIR})

# Source files
file(GLOB_RECURSE SOURCES 
    ${CPP_DIR}/ggml*.c
    ${CPP_DIR}/ggml*.cpp
    ${CPP_DIR}/whisper.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/whisper-jni.cpp
)

# Remove backend implementations that might need extra deps or flags if we want simple CPU build first
# For simplicity, we include everything and let CMake/Compiler filter or we might face duplicate symbols if not careful.
# But whisper.cpp structure separates backends. 
# Let's focus on core whisper + cpu.

add_library(whisper-jni SHARED ${SOURCES})

# Logging
find_library(log-lib log)

target_link_libraries(whisper-jni ${log-lib})
