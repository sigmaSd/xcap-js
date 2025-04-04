# xcap-js

A cross-platform screen capture library for Deno, providing bindings to the Rust
xcap library. This module allows capturing screenshots from multiple monitors on
Windows, macOS, and Linux.

## Usage Example

## Examples

**Example 1**

```typescript
import { captureMonitor, getMonitors, savePng } from "jsr:@sigma/xcap-js";

// List all available monitors
const monitors = getMonitors();
console.log("Available monitors:", monitors);

// Capture screenshot from the primary monitor
if (monitors.length > 0) {
  const screenshot = await captureMonitor(0n);
  console.log(`Captured ${screenshot.width}x${screenshot.height} image`);

  // Save the screenshot as PNG
  await savePng(screenshot, "./screenshot.png");
}
```
