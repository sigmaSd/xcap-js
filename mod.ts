/**
 * Represents information about a display monitor.
 */
export interface MonitorInfo {
  /** Platform-specific identifier for the monitor. */
  id: number;
  /** User-friendly name of the monitor. */
  name: string;
  /** The index of the monitor in the list returned by the system. Useful for capture functions. */
  index: bigint;
  /** Width of the monitor in pixels. */
  width: number;
  /** Height of the monitor in pixels. */
  height: number;
}

/**
 * Represents the raw data of a captured image.
 */
export interface CapturedImageData {
  /** Raw pixel data (usually RGBA). */
  data: Uint8Array;
  /** Width of the image in pixels. */
  width: number;
  /** Height of the image in pixels. */
  height: number;
}

// --- FFI Definition ---

const LIB_SUFFIX: Partial<Record<typeof Deno.build.os, string>> = {
  darwin: "dylib",
  linux: "so",
  windows: "dll",
};

const LIB_PREFIX: Partial<Record<typeof Deno.build.os, string>> = {
  darwin: "lib",
  linux: "lib",
  windows: "",
};

const libName = `${LIB_PREFIX[Deno.build.os]}capture_ffi.${
  LIB_SUFFIX[Deno.build.os]
}`;
// Assume the library is in the same directory or adjust path as needed
const libPath = new URL(libName, import.meta.url).pathname;
// Handle Windows path quirk if necessary: Deno expects URL path format.
// If libPath starts with /C:/ on windows, remove the leading /
const correctedLibPath = Deno.build.os === "windows" && libPath.startsWith("/")
  ? libPath.substring(1)
  : libPath;

// Define the C struct for Deno FFI
const CAPTURED_IMAGE_STRUCT_DEF = {
  struct: [
    "pointer", // data: *mut u8
    "usize", // len: size_t
    "u32", // width: c_uint
    "u32", // height: c_uint
  ],
} as const;

const symbols = {
  capture_monitor_count: {
    parameters: [],
    result: "usize",
  },
  capture_monitor_name: {
    parameters: ["usize"],
    result: "pointer", // *mut c_char
  },
  capture_monitor_id: {
    parameters: ["usize"],
    result: "u32", // c_uint
  },
  capture_monitor_width: {
    parameters: ["usize"],
    result: "u32", // c_uint
  },
  capture_monitor_height: {
    parameters: ["usize"],
    result: "u32", // c_uint
  },
  capture_monitor_image: {
    parameters: ["usize"],
    result: CAPTURED_IMAGE_STRUCT_DEF, // Our struct definition
    nonblocking: true, // Capture can take time
  },
  capture_free_string: {
    parameters: ["pointer"], // *mut c_char
    result: "void",
  },
  capture_free_image: {
    parameters: [CAPTURED_IMAGE_STRUCT_DEF], // Pass the struct by value
    result: "void",
  },
} as const;

// Load the library and define symbols
// Use try/catch for better error reporting if lib is missing
let lib: Deno.DynamicLibrary<typeof symbols>;
try {
  lib = Deno.dlopen(correctedLibPath, symbols);
} catch (e) {
  console.error(`Error loading library: ${libName} from ${correctedLibPath}`);
  console.error(
    "Ensure the compiled Rust library (capture-ffi) is in the correct location.",
  );
  console.error(e);
  // Re-throw or provide dummy functions if needed
  throw e;
}

// --- Public API ---

/**
 * Retrieves a list of all connected monitors.
 * @returns An array of MonitorInfo objects.
 * @throws Error if the native library fails to retrieve monitors.
 */
export function getMonitors(): MonitorInfo[] {
  const count = lib.symbols.capture_monitor_count();
  if (count === 0n) {
    // Could be no monitors or an error in the FFI layer
    // Check FFI error logs if necessary
    console.warn(
      "getMonitors: capture_monitor_count returned 0. No monitors detected or FFI error.",
    );
    return [];
  }

  const monitors: MonitorInfo[] = [];
  for (let i = 0n; i < count; i++) {
    const namePtr = lib.symbols.capture_monitor_name(i);
    let name = "Unknown"; // Default name
    if (namePtr !== null) {
      try {
        // Read the null-terminated C string
        name = new Deno.UnsafePointerView(namePtr).getCString();
      } catch (e) {
        console.error(`Error reading name for monitor ${i}:`, e);
      } finally {
        // IMPORTANT: Free the string allocated by Rust
        lib.symbols.capture_free_string(namePtr);
      }
    } else {
      console.warn(
        `getMonitors: capture_monitor_name returned null for index ${i}`,
      );
    }

    const id = lib.symbols.capture_monitor_id(i);
    const width = lib.symbols.capture_monitor_width(i);
    const height = lib.symbols.capture_monitor_height(i);

    monitors.push({ id, name, index: i, width, height });
  }

  return monitors;
}

/**
 * Captures a screenshot of the specified monitor by its index.
 * @param monitorIndex The index of the monitor (from MonitorInfo.index).
 * @returns A Promise resolving to CapturedImageData containing the screenshot.
 * @throws Error if the monitor index is invalid or capturing fails.
 */
export async function captureMonitor(
  monitorIndex: bigint,
): Promise<CapturedImageData> {
  // The FFI call is potentially blocking, so use await if nonblocking: true
  const rawStruct = await lib.symbols.capture_monitor_image(monitorIndex);

  console.log("Raw struct:", rawStruct);

  // Manual extraction from the struct without byte_type
  // In FFI structs are returned as TypedArrays
  const structData = new DataView(rawStruct.buffer);

  // Extract fields based on memory layout:
  // Assume 64-bit architecture (8-byte pointer and size_t)
  const dataPtr = Deno.UnsafePointer.create(structData.getBigUint64(0, true));
  const lenValue = Number(structData.getBigUint64(8, true));
  const width = structData.getUint32(16, true);
  const height = structData.getUint32(20, true);

  console.log("Extracted values:", {
    dataPtr: dataPtr ? "valid" : "null",
    lenValue,
    width,
    height,
  });

  if (dataPtr === null || lenValue === 0) {
    // Need to free the struct, but with null data pointer
    lib.symbols.capture_free_image(rawStruct);
    throw new Error(
      `Failed to capture image for monitor index ${monitorIndex}. Null data or zero length.`,
    );
  }

  let imageData: Uint8Array | null = null;
  try {
    // Create a view into the Rust-allocated memory
    const dataView = new Deno.UnsafePointerView(dataPtr);
    // Copy the data into a JS-managed Uint8Array
    imageData = new Uint8Array(dataView.getArrayBuffer(lenValue));
  } catch (e) {
    console.error("Error reading image data buffer:", e);
  } finally {
    // IMPORTANT: Free the image buffer allocated by Rust
    lib.symbols.capture_free_image(rawStruct);
  }

  if (!imageData) {
    throw new Error("Failed to read image data from memory");
  }

  return { data: imageData, width, height };
}

/**
 * Helper function to save captured image data to a PPM file.
 * Requires --allow-write permission.
 *
 * @param image The captured image data.
 * @param path The file path to save the PPM to.
 */
export async function savePPM(
  image: CapturedImageData,
  path: string,
): Promise<void> {
  // For now, we'll just save the raw image data as a simple PPM format
  try {
    // This creates a PPM file which is a simple image format to implement
    const header = `P6\n${image.width} ${image.height}\n255\n`;
    const headerBytes = new TextEncoder().encode(header);

    // Create RGB data from RGBA by dropping alpha channel
    const rgbData = new Uint8Array(image.width * image.height * 3);
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
      rgbData[j] = image.data[i]; // R
      rgbData[j + 1] = image.data[i + 1]; // G
      rgbData[j + 2] = image.data[i + 2]; // B
      // Skip alpha
    }

    // Combine header and RGB data
    const fileData = new Uint8Array(headerBytes.length + rgbData.length);
    fileData.set(headerBytes, 0);
    fileData.set(rgbData, headerBytes.length);

    // Write the PPM file
    await Deno.writeFile(path.replace(/\.png$/, ".ppm"), fileData);
    console.log(`Image saved as PPM to ${path.replace(/\.png$/, ".ppm")}`);
  } catch (e) {
    console.error(`Failed to save image: ${e}`);
    throw e;
  }
}

if (import.meta.main) {
  console.log("Running deno-xcap directly. Getting monitor info:");
  const monitors = getMonitors();
  console.log(monitors);

  if (monitors.length > 0) {
    console.log(`Capturing monitor 0 (${monitors[0].name})...`);
    const img = await captureMonitor(0n);
    console.log(
      `Captured ${img.width}x${img.height} image (${img.data.byteLength} bytes)`,
    );

    const path = `./screenshot-${Date.now()}.ppm`;
    console.log(`Saving to ${path}...`);
    await savePPM(img, path);
  }
}
