cmake_minimum_required(VERSION 3.15)
project(wello_hook)

set(CMAKE_CXX_STANDARD 17)

# Add MinHook library
add_subdirectory(../minhook ${CMAKE_BINARY_DIR}/minhook)

# Create the DLL
add_library(wello_hook SHARED hook.cpp)

# Link MinHook
target_link_libraries(wello_hook PRIVATE minhook)

# Output to a known directory
set_target_properties(wello_hook PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    OUTPUT_NAME "wello_hook"
)
