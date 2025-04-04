import * as plug from "jsr:@denosaurs/plug@1.0.6";
import metadata from "../deno.json" with { type: "json" };

export const library = await instantiate();

async function instantiate() {
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
    capture_last_error_message: {
      parameters: [],
      result: "pointer", // *const c_char
    },
  } as const;

  const name = "xcap_c_api";
  // NOTE: replace this url with the correct repo url
  const url =
    `https://github.com/sigmaSd/xcap-js/releases/download/${metadata.version}`;

  return await plug.dlopen(
    {
      name,
      url: Deno.env.get("RUST_LIB_PATH") || url,
      // reload cache if developping locally
      cache: Deno.env.get("RUST_LIB_PATH") ? "reloadAll" : "use",
      suffixes: {
        linux: {
          aarch64: "_arm64",
          x86_64: "_x86_64",
        },
        darwin: {
          aarch64: "_arm64",
          x86_64: "_x86_64",
        },
      },
    },
    symbols,
  );
}
