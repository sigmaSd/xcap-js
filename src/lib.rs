// capture-ffi/src/lib.rs
use libc::{c_char, c_uint, size_t};
use std::{cell::RefCell, ffi::CString, ptr, slice};
use xcap::{image::EncodableLayout, Monitor}; // Added image::Image

// --- Data Structures for FFI ---

/// Represents image data returned via FFI.
/// The caller is responsible for calling capture_free_image to release the data buffer.
#[repr(C)]
pub struct CapturedImage {
    /// Pointer to the raw RGBA pixel data.
    pub data: *mut u8,
    /// Length of the data buffer (width * height * 4).
    pub len: size_t,
    /// Width of the image in pixels.
    pub width: c_uint,
    /// Height of the image in pixels.
    pub height: c_uint,
}

// --- Helper for Error Handling (Optional but Recommended) ---
// Store the last error message
thread_local! {
    static LAST_ERROR: RefCell<Option<CString>> = RefCell::new(None);
}

fn set_last_error(err: String) {
    LAST_ERROR.with(|cell| {
        *cell.borrow_mut() = Some(
            CString::new(err)
                .unwrap_or_else(|_| CString::new("Failed to create error message").unwrap()),
        );
    });
}

#[no_mangle]
pub extern "C" fn capture_last_error_message() -> *const c_char {
    LAST_ERROR.with(|cell| cell.borrow().as_ref().map_or(ptr::null(), |s| s.as_ptr()))
}

// --- Monitor Functions ---

/// Gets the number of connected monitors.
/// Returns 0 if there's an error fetching the monitors.
#[no_mangle]
pub extern "C" fn capture_monitor_count() -> size_t {
    match Monitor::all() {
        Ok(monitors) => monitors.len(),
        Err(e) => {
            let err_msg = format!("Error fetching monitors: {}", e);
            eprintln!("{}", err_msg);
            set_last_error(err_msg);
            0
        }
    }
}

/// Gets the name of the monitor at the specified index.
/// Returns a pointer to a null-terminated UTF-8 string.
/// The caller MUST call capture_free_string() on the returned pointer to free the memory.
/// Returns NULL if the index is out of bounds or an error occurs.
#[no_mangle]
pub extern "C" fn capture_monitor_name(index: size_t) -> *mut c_char {
    match Monitor::all() {
        Ok(monitors) => {
            if let Some(monitor) = monitors.get(index) {
                // Using monitor.name() which might return an OsString needing conversion
                match CString::new(monitor.name()) {
                    Ok(c_string) => c_string.into_raw(),
                    Err(_) => {
                        let err_msg = format!("Monitor name contains null bytes");
                        set_last_error(err_msg);
                        ptr::null_mut() // Name contained null bytes
                    }
                }
            } else {
                // Index out of bounds
                let err_msg = format!("Monitor index out of bounds: {}", index);
                set_last_error(err_msg);
                ptr::null_mut()
            }
        }
        Err(e) => {
            // Error fetching monitors
            let err_msg = format!("Error fetching monitors: {}", e);
            set_last_error(err_msg);
            ptr::null_mut()
        }
    }
}

/// Gets the platform-specific ID of the monitor at the specified index.
/// Returns 0 if the index is out of bounds or an error occurs (assuming 0 is not a valid ID).
/// Note: Monitor IDs might not be stable across reboots or system changes.
#[no_mangle]
pub extern "C" fn capture_monitor_id(index: size_t) -> c_uint {
    match Monitor::all() {
        Ok(monitors) => {
            if let Some(m) = monitors.get(index) {
                m.id()
            } else {
                let err_msg = format!("Monitor index out of bounds: {}", index);
                set_last_error(err_msg);
                0
            }
        }
        Err(e) => {
            // Error fetching monitors
            let err_msg = format!("Error fetching monitors: {}", e);
            set_last_error(err_msg);
            0
        }
    }
}

/// Gets the width of the monitor at the specified index.
/// Returns 0 if the index is out of bounds or an error occurs.
#[no_mangle]
pub extern "C" fn capture_monitor_width(index: size_t) -> c_uint {
    match Monitor::all() {
        Ok(monitors) => {
            if let Some(m) = monitors.get(index) {
                m.width()
            } else {
                let err_msg = format!("Monitor index out of bounds: {}", index);
                set_last_error(err_msg);
                0
            }
        }
        Err(e) => {
            let err_msg = format!("Error fetching monitors: {}", e);
            set_last_error(err_msg);
            0
        }
    }
}

/// Gets the height of the monitor at the specified index.
/// Returns 0 if the index is out of bounds or an error occurs.
#[no_mangle]
pub extern "C" fn capture_monitor_height(index: size_t) -> c_uint {
    match Monitor::all() {
        Ok(monitors) => {
            if let Some(m) = monitors.get(index) {
                m.height()
            } else {
                let err_msg = format!("Monitor index out of bounds: {}", index);
                set_last_error(err_msg);
                0
            }
        }
        Err(e) => {
            let err_msg = format!("Error fetching monitors: {}", e);
            set_last_error(err_msg);
            0
        }
    }
}

// --- Capture Functions ---

/// Captures an image of the monitor at the specified index.
/// Returns a CapturedImage struct containing the image data.
/// The caller MUST call capture_free_image() on the returned struct to free the data buffer.
/// Returns a struct with NULL data pointer and zero dimensions if an error occurs or index is invalid.
#[no_mangle]
pub extern "C" fn capture_monitor_image(index: size_t) -> CapturedImage {
    let empty_image = CapturedImage {
        data: ptr::null_mut(),
        len: 0,
        width: 0,
        height: 0,
    };

    match Monitor::all() {
        Ok(monitors) => {
            if let Some(monitor) = monitors.get(index) {
                match monitor.capture_image() {
                    Ok(image) => {
                        let width = image.width();
                        let height = image.height();

                        let buffer_data = image.as_bytes().to_vec();

                        let mut buffer = buffer_data.into_boxed_slice();
                        let data = buffer.as_mut_ptr();
                        let len = buffer.len();

                        // Prevent Rust from freeing the memory now; C side will call capture_free_image
                        std::mem::forget(buffer);

                        CapturedImage {
                            data,
                            len,
                            width,
                            height,
                        }
                    }
                    Err(e) => {
                        let err_msg = format!("Error capturing image for monitor {}: {}", index, e);
                        eprintln!("{}", err_msg);
                        set_last_error(err_msg);
                        empty_image
                    }
                }
            } else {
                let err_msg = format!("Invalid monitor index: {}", index);
                eprintln!("{}", err_msg);
                set_last_error(err_msg);
                empty_image
            }
        }
        Err(e) => {
            let err_msg = format!("Error fetching monitors: {}", e);
            eprintln!("{}", err_msg);
            set_last_error(err_msg);
            empty_image
        }
    }
}

// --- Memory Management Functions ---

/// Frees a C string allocated by Rust (e.g., returned by capture_monitor_name).
/// Call this with the pointer received from Rust functions that return *mut c_char.
#[no_mangle]
pub unsafe extern "C" fn capture_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        // Retake ownership of the pointer so CString's Drop implementation runs.
        let _ = CString::from_raw(ptr);
    }
}

/// Frees the image data buffer allocated by Rust (contained within CapturedImage).
/// Call this with the struct received from capture_monitor_image.
#[no_mangle]
pub unsafe extern "C" fn capture_free_image(image: CapturedImage) {
    if !image.data.is_null() {
        // Reconstruct the Vec<u8> or Box<[u8]> from the raw parts and let it drop.
        // We know len is the original length. Capacity might differ, but from_raw_parts handles this.
        let slice = slice::from_raw_parts_mut(image.data, image.len);
        let _ = Box::from_raw(slice); // Takes ownership and drops when scope ends.
    }
}
