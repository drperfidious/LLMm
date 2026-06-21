#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct IconVariant {
  let name: String
  let top: NSColor
  let middle: NSColor
  let bottom: NSColor
  let backgroundTop: NSColor
  let backgroundBottom: NSColor
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let appIconSet = root.appendingPathComponent("ios/PocketPal/Images.xcassets/AppIcon.appiconset")
let iconComposerDir = root.appendingPathComponent("ios/PocketPal/AppIcon.icon")
let iconComposerAssetsDir = iconComposerDir.appendingPathComponent("Assets")
let brandDir = root.appendingPathComponent("assets/brand")
let srcAssetsDir = root.appendingPathComponent("src/assets")

try FileManager.default.createDirectory(at: brandDir, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: srcAssetsDir, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: iconComposerDir, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: iconComposerAssetsDir, withIntermediateDirectories: true)
try? FileManager.default.removeItem(at: iconComposerDir.appendingPathComponent("llmm-mark.png"))

func color(_ hex: UInt32) -> NSColor {
  let r = CGFloat((hex >> 16) & 0xff) / 255.0
  let g = CGFloat((hex >> 8) & 0xff) / 255.0
  let b = CGFloat(hex & 0xff) / 255.0
  return NSColor(calibratedRed: r, green: g, blue: b, alpha: 1)
}

let variants = [
  IconVariant(
    name: "App_store_1024_1x.png",
    top: color(0xF3F8FA),
    middle: color(0xA7C5CC),
    bottom: color(0x5D737C),
    backgroundTop: color(0x1A2026),
    backgroundBottom: color(0x05070A)
  ),
  IconVariant(
    name: "App_store_dark_1024_1x.png",
    top: color(0xF8FBFC),
    middle: color(0xD5E0E4),
    bottom: color(0x8EA0A8),
    backgroundTop: color(0x11161B),
    backgroundBottom: color(0x020304)
  ),
  IconVariant(
    name: "App_store_tinted_1024_1x.png",
    top: color(0xFFFFFF),
    middle: color(0xC9D0D4),
    bottom: color(0x747D84),
    backgroundTop: color(0x14181C),
    backgroundBottom: color(0x050607)
  ),
]

func bezierPath(points: [CGPoint]) -> NSBezierPath {
  let path = NSBezierPath()
  path.move(to: points[0])
  var index = 1
  while index + 2 < points.count {
    path.curve(to: points[index + 2], controlPoint1: points[index], controlPoint2: points[index + 1])
    index += 3
  }
  return path
}

func drawVariant(_ variant: IconVariant, pixels: Int) throws -> CGImage {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard
    let cgContext = CGContext(
      data: nil,
      width: pixels,
      height: pixels,
      bitsPerComponent: 8,
      bytesPerRow: pixels * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ),
    let context = Optional(NSGraphicsContext(cgContext: cgContext, flipped: false))
  else {
    throw NSError(domain: "LLMmIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create bitmap context"])
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  NSGraphicsContext.current?.imageInterpolation = .high

  let size = CGFloat(pixels)
  NSColor.black.setFill()
  NSRect(x: 0, y: 0, width: size, height: size).fill()

  let bg = NSGradient(starting: variant.backgroundTop, ending: variant.backgroundBottom)
  bg?.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: 90)

  let scale = size / 1024.0
  let centerGlow = NSGradient(colors: [
    NSColor(calibratedWhite: 1.0, alpha: 0.10),
    NSColor(calibratedWhite: 1.0, alpha: 0.00),
  ])
  let glowRect = NSRect(x: 160 * scale, y: 250 * scale, width: 704 * scale, height: 600 * scale)
  centerGlow?.draw(in: glowRect, relativeCenterPosition: NSPoint(x: 0, y: 0))

  let rows: [(CGFloat, CGFloat, NSColor)] = [
    (650, 92, variant.top),
    (522, 86, variant.middle),
    (396, 80, variant.bottom),
  ]

  let shapePoints: [CGPoint] = [
    CGPoint(x: 190, y: 0),
    CGPoint(x: 260, y: 70),
    CGPoint(x: 335, y: 136),
    CGPoint(x: 422, y: 136),
    CGPoint(x: 474, y: 136),
    CGPoint(x: 496, y: 86),
    CGPoint(x: 512, y: 70),
    CGPoint(x: 528, y: 86),
    CGPoint(x: 550, y: 136),
    CGPoint(x: 602, y: 136),
    CGPoint(x: 689, y: 136),
    CGPoint(x: 764, y: 70),
    CGPoint(x: 834, y: 0),
  ]

  for (baseline, lineWidth, fillColor) in rows {
    let points = shapePoints.map { CGPoint(x: $0.x * scale, y: ($0.y + baseline) * scale) }
    let path = bezierPath(points: points)
    path.lineWidth = lineWidth * scale
    path.lineCapStyle = .round
    path.lineJoinStyle = .round

    let shadow = NSShadow()
    shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.55)
    shadow.shadowOffset = NSSize(width: 0, height: -12 * scale)
    shadow.shadowBlurRadius = 20 * scale
    shadow.set()
    NSColor(calibratedWhite: 0, alpha: 0.72).setStroke()
    path.stroke()
    NSShadow().set()

    fillColor.setStroke()
    path.stroke()

    let highlight = path.copy() as! NSBezierPath
    highlight.lineWidth = max(2, lineWidth * 0.11 * scale)
    NSColor(calibratedWhite: 1.0, alpha: 0.46).setStroke()
    highlight.stroke()
  }

  let border = NSBezierPath(roundedRect: NSRect(x: 22 * scale, y: 22 * scale, width: 980 * scale, height: 980 * scale), xRadius: 170 * scale, yRadius: 170 * scale)
  border.lineWidth = max(1, 2 * scale)
  NSColor(calibratedWhite: 1.0, alpha: 0.10).setStroke()
  border.stroke()

  NSGraphicsContext.restoreGraphicsState()
  guard let image = cgContext.makeImage() else {
    throw NSError(domain: "LLMmIcon", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create CGImage"])
  }
  return image
}

func drawMarkLayer(pixels: Int) throws -> CGImage {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard
    let cgContext = CGContext(
      data: nil,
      width: pixels,
      height: pixels,
      bitsPerComponent: 8,
      bytesPerRow: pixels * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ),
    let context = Optional(NSGraphicsContext(cgContext: cgContext, flipped: false))
  else {
    throw NSError(domain: "LLMmIcon", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not create mark bitmap context"])
  }

  cgContext.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  NSGraphicsContext.current?.imageInterpolation = .high

  let size = CGFloat(pixels)
  let scale = size / 1024.0
  let rows: [(CGFloat, CGFloat, NSColor)] = [
    (650, 92, NSColor(calibratedWhite: 1.0, alpha: 0.96)),
    (522, 86, color(0xB8D0D8).withAlphaComponent(0.92)),
    (396, 80, color(0x748A94).withAlphaComponent(0.92)),
  ]
  let shapePoints: [CGPoint] = [
    CGPoint(x: 190, y: 0),
    CGPoint(x: 260, y: 70),
    CGPoint(x: 335, y: 136),
    CGPoint(x: 422, y: 136),
    CGPoint(x: 474, y: 136),
    CGPoint(x: 496, y: 86),
    CGPoint(x: 512, y: 70),
    CGPoint(x: 528, y: 86),
    CGPoint(x: 550, y: 136),
    CGPoint(x: 602, y: 136),
    CGPoint(x: 689, y: 136),
    CGPoint(x: 764, y: 70),
    CGPoint(x: 834, y: 0),
  ]

  for (baseline, lineWidth, fillColor) in rows {
    let points = shapePoints.map { CGPoint(x: $0.x * scale, y: ($0.y + baseline) * scale) }
    let path = bezierPath(points: points)
    path.lineWidth = lineWidth * scale
    path.lineCapStyle = .round
    path.lineJoinStyle = .round

    let shadow = NSShadow()
    shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.48)
    shadow.shadowOffset = NSSize(width: 0, height: -10 * scale)
    shadow.shadowBlurRadius = 16 * scale
    shadow.set()
    fillColor.setStroke()
    path.stroke()
    NSShadow().set()

    let highlight = path.copy() as! NSBezierPath
    highlight.lineWidth = max(2, lineWidth * 0.10 * scale)
    NSColor(calibratedWhite: 1.0, alpha: 0.38).setStroke()
    highlight.stroke()
  }

  NSGraphicsContext.restoreGraphicsState()
  guard let image = cgContext.makeImage() else {
    throw NSError(domain: "LLMmIcon", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not create mark CGImage"])
  }
  return image
}

func writePNG(_ image: CGImage, to url: URL) throws {
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "LLMmIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG for \(url.path)"])
  }
  CGImageDestinationAddImage(destination, image, nil)
  if !CGImageDestinationFinalize(destination) {
    throw NSError(domain: "LLMmIcon", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not write PNG for \(url.path)"])
  }
}

let defaultImage = try drawVariant(variants[0], pixels: 1024)

let staleIconFiles = try FileManager.default.contentsOfDirectory(at: appIconSet, includingPropertiesForKeys: nil)
for file in staleIconFiles where file.lastPathComponent.hasPrefix("iPhone_") || file.lastPathComponent.hasPrefix("iPad_") {
  try FileManager.default.removeItem(at: file)
}

for variant in variants {
  let image = variant.name == variants[0].name ? defaultImage : try drawVariant(variant, pixels: 1024)
  try writePNG(image, to: appIconSet.appendingPathComponent(variant.name))
}

try writePNG(defaultImage, to: brandDir.appendingPathComponent("llmm-app-icon-source.png"))
try writePNG(try drawVariant(variants[0], pixels: 512), to: srcAssetsDir.appendingPathComponent("llmm-app-icon.png"))
try writePNG(try drawMarkLayer(pixels: 1024), to: iconComposerAssetsDir.appendingPathComponent("llmm-mark.png"))

let iconComposerManifest = """
{
  "fill" : {
    "automatic-gradient" : "extended-srgb:0.01961,0.02745,0.03922,1.00000"
  },
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "llmm-mark.png",
          "name" : "LLMm Mark",
          "position" : {
            "scale" : 1,
            "translation-in-points" : [
              0,
              0
            ]
          }
        }
      ],
      "shadow" : {
        "kind" : "neutral",
        "opacity" : 0.45
      },
      "translucency" : {
        "enabled" : true,
        "value" : 0.35
      }
    }
  ],
  "supported-platforms" : {
    "squares" : [
      "iOS"
    ]
  }
}
"""

try iconComposerManifest.write(
  to: iconComposerDir.appendingPathComponent("icon.json"),
  atomically: true,
  encoding: .utf8
)

print("Generated LLMm icons in \(appIconSet.path)")
