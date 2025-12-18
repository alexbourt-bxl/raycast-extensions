import Cocoa
import Foundation
import ScreenCaptureKit

enum ExitCode
{
  static let ok: Int32 = 0
  static let canceled: Int32 = 2
  static let timeout: Int32 = 4
  static let failed: Int32 = 1
}

typealias PixelPick =
[
  String: Any
]

private let zoom: CGFloat = 12
private let sampleSize: Int = 17
private let paddingPx: CGFloat = 10

func clamp(_ value: Int, _ min: Int, _ max: Int) -> Int
{
  if value < min
  {
    return min
  }

  if value > max
  {
    return max
  }

  return value
}

func hexFromColor(_ color: NSColor) -> String
{
  let srgb = color.usingColorSpace(.sRGB) ?? color
  let r = Int(round(srgb.redComponent * 255.0))
  let g = Int(round(srgb.greenComponent * 255.0))
  let b = Int(round(srgb.blueComponent * 255.0))
  return String(format: "#%02X%02X%02X", r, g, b)
}

func jsonLine(_ obj: Any) -> String
{
  let data = try! JSONSerialization.data(withJSONObject: obj, options:
  [
    .withoutEscapingSlashes,
  ])
  return String(data: data, encoding: .utf8) ?? "{}"
}

func writeOutFile(path: String, payload: Any)
{
  let text = jsonLine(payload)
  try? text.write(toFile: path, atomically: true, encoding: .utf8)
}

struct Args
{
  var timeoutMs: Int = 60000
  var outPath: String?
  var sampleFgX: Int?
  var sampleFgY: Int?
  var sampleBgX: Int?
  var sampleBgY: Int?
}

func parseArgs() -> Args
{
  var args = Args()
  var i = 1
  let argv = CommandLine.arguments

  while i < argv.count
  {
    let arg = argv[i]

    if arg == "--timeout-ms" && i + 1 < argv.count
    {
      args.timeoutMs = Int(argv[i + 1]) ?? args.timeoutMs
      i += 2
      continue
    }

    if arg == "--out" && i + 1 < argv.count
    {
      args.outPath = argv[i + 1]
      i += 2
      continue
    }

    if arg == "--sample-fg-x" && i + 1 < argv.count
    {
      args.sampleFgX = Int(argv[i + 1])
      i += 2
      continue
    }

    if arg == "--sample-fg-y" && i + 1 < argv.count
    {
      args.sampleFgY = Int(argv[i + 1])
      i += 2
      continue
    }

    if arg == "--sample-bg-x" && i + 1 < argv.count
    {
      args.sampleBgX = Int(argv[i + 1])
      i += 2
      continue
    }

    if arg == "--sample-bg-y" && i + 1 < argv.count
    {
      args.sampleBgY = Int(argv[i + 1])
      i += 2
      continue
    }

    i += 1
  }

  return args
}

final class PickerState
{
  var foreground: PixelPick? = nil
  var background: PixelPick? = nil
  var finished: Bool = false
  var exitCode: Int32 = ExitCode.ok
  var errorMessage: String? = nil
  var pickedCount: Int = 0
}

let args = parseArgs()
let timeoutSeconds = max(1, args.timeoutMs) / 1000
let state = PickerState()

func samplePixelPick(x: Int, y: Int) -> PixelPick?
{
  let p = CGPoint(x: CGFloat(x), y: CGFloat(y))
  guard let color = readPixelColorAtGlobalPoint(p)
  else
  {
    return nil
  }

  return (
  [
    "x": x,
    "y": y,
    "hex": hexFromColor(color),
  ])
}

if
  let fgX = args.sampleFgX,
  let fgY = args.sampleFgY,
  let bgX = args.sampleBgX,
  let bgY = args.sampleBgY
{
  guard
    let fg = samplePixelPick(x: fgX, y: fgY),
    let bg = samplePixelPick(x: bgX, y: bgY)
  else
  {
    fputs("Failed to read pixel color. Ensure Raycast has Screen Recording permission.\n", stderr)
    exit(ExitCode.failed)
  }

  let payload:
  [
    String: Any
  ] =
  [
    "foreground": fg,
    "background": bg,
  ]

  if let outPath = args.outPath
  {
    writeOutFile(path: outPath, payload: payload)
  }

  print(jsonLine(payload))
  exit(ExitCode.ok)
}

func finish(success: Bool)
{
  if state.finished
  {
    return
  }

  state.finished = true

  if success
  {
    let payload:
    [
      String: Any
    ] =
    [
      "foreground": state.foreground ?? [:],
      "background": state.background ?? [:],
    ]

    if let outPath = args.outPath
    {
      writeOutFile(path: outPath, payload: payload)
    }

    print(jsonLine(payload))
    exit(ExitCode.ok)
  }

  if let message = state.errorMessage
  {
    fputs(message + "\n", stderr)
  }

  exit(state.exitCode)
}

func globalPointFromEvent(_ event: CGEvent) -> CGPoint
{
  // CGEvent locations are in global display coordinates.
  return event.location
}

func globalPointFromMouseLocation() -> CGPoint
{
  // NSEvent.mouseLocation is in AppKit screen coordinates.
  // Convert to CoreGraphics global coordinates for screen capture.
  let mouse = NSEvent.mouseLocation
  let displayBounds = CGDisplayBounds(CGMainDisplayID())
  let y = displayBounds.height - mouse.y
  return CGPoint(x: mouse.x, y: y)
}

@available(macOS 12.3, *)
func screenshotMainDisplay(rect: CGRect) async throws -> CGImage?
{
  let shareable = try await SCShareableContent.current

  let mainID = CGMainDisplayID()
  guard let display = shareable.displays.first(where:
  {
    $0.displayID == mainID
  })
  else
  {
    return nil
  }

  let excludingApps: [SCRunningApplication] =
  [
  ]

  let exceptingWindows: [SCWindow] =
  [
  ]

  let filter = SCContentFilter(
    display: display,
    excludingApplications: excludingApps,
    exceptingWindows: exceptingWindows
  )

  let config = SCStreamConfiguration()
  let src = rect.integral
  config.sourceRect = src
  config.width = max(1, Int(src.width))
  config.height = max(1, Int(src.height))

  return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}

func captureMainDisplayImage(rect: CGRect) -> CGImage?
{
  if #available(macOS 12.3, *)
  {
    let semaphore = DispatchSemaphore(value: 0)
    var image: CGImage? = nil

    Task
    {
      do
      {
        image = try await screenshotMainDisplay(rect: rect)
      }
      catch
      {
        image = nil
      }

      semaphore.signal()
    }

    semaphore.wait()
    return image
  }

  return nil
}

func readPixelColorAtGlobalPoint(_ point: CGPoint) -> NSColor?
{
  guard let image = captureMainDisplayImage(rect: CGRect(x: point.x, y: point.y, width: 1, height: 1))
  else
  {
    return nil
  }

  let bitmap = NSBitmapImageRep(cgImage: image)
  return bitmap.colorAt(x: 0, y: 0)
}

func captureMagnifiedImageAtGlobalPoint(_ point: CGPoint) -> NSImage?
{
  let half = sampleSize / 2

  let src = CGRect(
    x: point.x - CGFloat(half),
    y: point.y - CGFloat(half),
    width: CGFloat(sampleSize),
    height: CGFloat(sampleSize)
  )

  guard let cgImage = captureMainDisplayImage(rect: src)
  else
  {
    return nil
  }

  let small = NSImage(cgImage: cgImage, size: NSSize(width: sampleSize, height: sampleSize))
  let destSize = NSSize(width: CGFloat(sampleSize) * zoom, height: CGFloat(sampleSize) * zoom)
  let large = NSImage(size: destSize)

  large.lockFocus()
  NSGraphicsContext.current?.imageInterpolation = .none
  small.draw(in: NSRect(origin: .zero, size: destSize), from: NSRect(origin: .zero, size: small.size), operation: .copy, fraction: 1.0)
  large.unlockFocus()

  return large
}

final class MagnifierView : NSView
{
  private var timer: Timer? = nil
  private var hoverHex: String = ""
  private var hoverColor: NSColor? = nil
  private var magnified: NSImage? = nil

  override var isFlipped: Bool
  {
    return true
  }

  override func viewDidMoveToWindow()
  {
    super.viewDidMoveToWindow()

    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true)
    {
      _ in

      self.updateStateAndRepaint()
    }
  }

  override func draw(_ dirtyRect: NSRect)
  {
    NSColor(calibratedWhite: 0.08, alpha: 1.0).setFill()
    dirtyRect.fill()

    let magnifierRect = NSRect(
      x: paddingPx,
      y: paddingPx,
      width: CGFloat(sampleSize) * zoom,
      height: CGFloat(sampleSize) * zoom
    )

    if let image = magnified
    {
      NSGraphicsContext.current?.imageInterpolation = .none
      image.draw(in: magnifierRect)
    }

    NSColor(calibratedWhite: 1.0, alpha: 0.9).setStroke()
    let border = NSBezierPath(rect: magnifierRect)
    border.lineWidth = 2
    border.stroke()

    drawGridAndCrosshair(in: magnifierRect)
    drawText()
  }

  private func updateStateAndRepaint()
  {
    if state.finished
    {
      return
    }

    let p = globalPointFromMouseLocation()

    if let color = readPixelColorAtGlobalPoint(p)
    {
      hoverColor = color.usingColorSpace(.sRGB) ?? color
      hoverHex = hexFromColor(color)
    }
    else
    {
      hoverColor = nil
      hoverHex = ""
    }

    magnified = captureMagnifiedImageAtGlobalPoint(p)

    if let window = self.window
    {
      repositionWindowNearCursor(window)
    }

    needsDisplay = true
  }

  private func drawGridAndCrosshair(in rect: NSRect)
  {
    NSColor(calibratedWhite: 1.0, alpha: 0.25).setStroke()

    let grid = NSBezierPath()
    grid.lineWidth = 1

    for i in 1..<sampleSize
    {
      let x = rect.minX + CGFloat(i) * zoom
      let y = rect.minY + CGFloat(i) * zoom

      grid.move(to: CGPoint(x: x, y: rect.minY))
      grid.line(to: CGPoint(x: x, y: rect.maxY))

      grid.move(to: CGPoint(x: rect.minX, y: y))
      grid.line(to: CGPoint(x: rect.maxX, y: y))
    }

    grid.stroke()

    let centerIndex = sampleSize / 2
    let cx = rect.minX + CGFloat(centerIndex) * zoom
    let cy = rect.minY + CGFloat(centerIndex) * zoom

    NSColor(calibratedRed: 1.0, green: 0.31, blue: 0.31, alpha: 0.9).setStroke()
    let cross = NSBezierPath(rect: NSRect(x: cx, y: cy, width: zoom, height: zoom))
    cross.lineWidth = 2
    cross.stroke()
  }

  private func drawText()
  {
    let text = hoverHex

    let attrs:
    [
      NSAttributedString.Key: Any
    ] =
    [
      .font: NSFont.systemFont(ofSize: 12, weight: .regular),
      .foregroundColor: NSColor.white,
    ]

    let y = bounds.height - 26
    let x = paddingPx

    let swatchSize: CGFloat = 16
    let swatchRect = NSRect(x: x, y: y - 2, width: swatchSize, height: swatchSize)
    drawSwatch(in: swatchRect)

    let textX = x + swatchSize + 8

    (text as NSString).draw(at: CGPoint(x: textX, y: y), withAttributes: attrs)
  }

  private func drawSwatch(in rect: NSRect)
  {
    let color = hoverColor ?? NSColor.magenta

    color.setFill()
    rect.fill()

    NSColor(calibratedWhite: 1.0, alpha: 0.6).setStroke()
    let border = NSBezierPath(rect: rect)
    border.lineWidth = 1
    border.stroke()
  }
}

func repositionWindowNearCursor(_ window: NSWindow)
{
  // AppKit window coordinates use bottom-left origin.
  let mouse = NSEvent.mouseLocation

  guard let screen = NSScreen.screens.first(where:
  {
    NSPointInRect(mouse, $0.frame)
  })
  else
  {
    return
  }

  let frame = window.frame
  let screenFrame = screen.visibleFrame

  var x = mouse.x + 24
  var y = mouse.y - frame.height - 24

  if x + frame.width > screenFrame.maxX
  {
    x = mouse.x - frame.width - 24
  }

  if y < screenFrame.minY
  {
    y = mouse.y + 24
  }

  x = CGFloat(clamp(Int(x), Int(screenFrame.minX), Int(screenFrame.maxX - frame.width)))
  y = CGFloat(clamp(Int(y), Int(screenFrame.minY), Int(screenFrame.maxY - frame.height)))

  window.setFrameOrigin(NSPoint(x: x, y: y))
}

func setPick(isForeground: Bool, globalPoint: CGPoint)
{
  guard let color = readPixelColorAtGlobalPoint(globalPoint)
  else
  {
    state.exitCode = ExitCode.failed
    state.errorMessage = "Failed to read pixel color. Ensure Raycast has Screen Recording permission."
    finish(success: false)
    return
  }

  let pick:
  [
    String: Any
  ] =
  [
    "x": Int(globalPoint.x),
    "y": Int(globalPoint.y),
    "hex": hexFromColor(color),
  ]

  if isForeground
  {
    state.foreground = pick
  }
  else
  {
    state.background = pick
  }

  state.pickedCount += 1

  var progress:
  [
    String: Any
  ] =
  [
    :
  ]

  if let fg = state.foreground
  {
    progress["foreground"] = fg
  }

  if let bg = state.background
  {
    progress["background"] = bg
  }

  print(jsonLine(progress))

  if state.foreground != nil && state.background != nil
  {
    finish(success: true)
  }
}

let eventMask =
(
  1 << CGEventType.leftMouseDown.rawValue
) |
(
  1 << CGEventType.keyDown.rawValue
)

let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(eventMask),
  callback:
  {
    _, type, event, _ in

    if state.finished
    {
      return Unmanaged.passUnretained(event)
    }

    if type == .keyDown
    {
      let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
      if keyCode == 53
      {
        state.exitCode = ExitCode.canceled
        state.errorMessage = "PICKER_CANCELED"
        finish(success: false)
        return nil
      }
    }

    if type == .leftMouseDown
    {
      let loc = globalPointFromEvent(event)

      if state.foreground == nil
      {
        setPick(isForeground: true, globalPoint: loc)
      }
      else if state.background == nil
      {
        setPick(isForeground: false, globalPoint: loc)
      }

      return nil
    }

    return Unmanaged.passUnretained(event)
  },
  userInfo: nil
)

guard let tap
else
{
  state.exitCode = ExitCode.failed
  state.errorMessage = "Failed to create event tap. Ensure Raycast has Accessibility permission."
  finish(success: false)
  exit(ExitCode.failed)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let windowSize = NSSize(
  width: CGFloat(sampleSize) * zoom + (paddingPx * 2),
  height: CGFloat(sampleSize) * zoom + (paddingPx * 2) + 40
)

let window = NSWindow(
  contentRect: NSRect(origin: .zero, size: windowSize),
  styleMask:
  [
    .borderless,
  ],
  backing: .buffered,
  defer: false
)

window.level = .floating
window.isOpaque = false
window.backgroundColor = .clear
window.hasShadow = true
window.ignoresMouseEvents = true
window.collectionBehavior =
[
  .canJoinAllSpaces,
  .fullScreenAuxiliary,
]

let view = MagnifierView(frame: NSRect(origin: .zero, size: windowSize))
window.contentView = view
window.makeKeyAndOrderFront(nil)

DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(timeoutSeconds))
{
  if !state.finished
  {
    state.exitCode = ExitCode.timeout
    state.errorMessage = "PICKER_TIMEOUT"
    finish(success: false)
  }
}

app.run()
