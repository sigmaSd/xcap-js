import { library } from "./ffi.ts";
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

/**
 * Retrieves the last error message from the native library.
 * @returns The error message, or null if there's no error.
 */
export function getLastError(): string | null {
  const ptr = library.symbols.capture_last_error_message();
  if (ptr === null) {
    return null;
  }
  return new Deno.UnsafePointerView(ptr).getCString();
}

// --- Public API ---

/**
 * Retrieves a list of all connected monitors.
 * @returns An array of MonitorInfo objects.
 * @throws Error if the native library fails to retrieve monitors.
 */
export function getMonitors(): MonitorInfo[] {
  const count = library.symbols.capture_monitor_count();
  if (count === 0n) {
    const error = getLastError();
    if (error) {
      throw new Error(`Failed to get monitors: ${error}`);
    }
    console.warn(
      "getMonitors: capture_monitor_count returned 0. No monitors detected.",
    );
    return [];
  }

  const monitors: MonitorInfo[] = [];
  for (let i = 0n; i < count; i++) {
    const namePtr = library.symbols.capture_monitor_name(i);
    let name = "Unknown"; // Default name
    if (namePtr !== null) {
      try {
        // Read the null-terminated C string
        name = new Deno.UnsafePointerView(namePtr).getCString();
      } catch (e) {
        console.error(`Error reading name for monitor ${i}:`, e);
      } finally {
        // IMPORTANT: Free the string allocated by Rust
        library.symbols.capture_free_string(namePtr);
      }
    } else {
      const error = getLastError();
      if (error) {
        console.warn(`Monitor ${i} name error: ${error}`);
      } else {
        console.warn(
          `getMonitors: capture_monitor_name returned null for index ${i}`,
        );
      }
    }

    const id = library.symbols.capture_monitor_id(i);
    const width = library.symbols.capture_monitor_width(i);
    const height = library.symbols.capture_monitor_height(i);

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
  const rawStruct = await library.symbols.capture_monitor_image(monitorIndex);

  // Manual extraction from the struct without byte_type
  // In FFI structs are returned as TypedArrays
  const structData = new DataView(rawStruct.buffer);

  // Extract fields based on memory layout:
  // Assume 64-bit architecture (8-byte pointer and size_t)
  const dataPtr = Deno.UnsafePointer.create(structData.getBigUint64(0, true));
  const lenValue = Number(structData.getBigUint64(8, true));
  const width = structData.getUint32(16, true);
  const height = structData.getUint32(20, true);

  if (dataPtr === null || lenValue === 0) {
    // Need to free the struct, but with null data pointer
    library.symbols.capture_free_image(rawStruct);
    const error = getLastError();
    throw new Error(
      `Failed to capture image for monitor index ${monitorIndex}: ${
        error || "Null data or zero length"
      }`,
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
    library.symbols.capture_free_image(rawStruct);
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
    await Deno.writeFile(path, fileData);
    console.log(`Image saved as PPM to ${path.replace(/\.png$/, ".ppm")}`);
  } catch (e) {
    console.error(`Failed to save image: ${e}`);
    throw e;
  }
}

/**
 * Helper function to save captured image data to a PNG file.
 * Requires --allow-write permission.
 * Uses the @img/png library for PNG encoding.
 *
 * @param image The captured image data.
 * @param path The file path to save the PNG to.
 */
export async function savePng(
  image: CapturedImageData,
  path: string,
): Promise<void> {
  try {
    // Import the PNG encoder
    const { encodePNG } = await import("jsr:@img/png@0.1.2");

    // Encode the raw pixel data to PNG format
    const pngData = await encodePNG(image.data, {
      width: image.width,
      height: image.height,
      compression: 0, // Maximum compression (0-9)
      filter: 0, // No filtering
      interlace: 0, // No interlacing
    });

    // Write the PNG data to file
    await Deno.writeFile(path, pngData);
    console.log(`Image saved as PNG to ${path}`);
  } catch (e) {
    console.error(`Failed to save PNG: ${e}`);
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

    {
      const path = `./screenshot-${Date.now()}.ppm`;
      console.log(`Saving to ${path}...`);
      await savePPM(img, path);
    }
    {
      const path = `./screenshot-${Date.now()}.png`;
      console.log(`Saving to ${path}...`);
      await savePng(img, path);
    }
  }
}
