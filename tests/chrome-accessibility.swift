// Native accessibility inspection/clicks, scoped to one explicitly supplied
// disposable Chrome PID. Never used against the user's general browser.
import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
let args = CommandLine.arguments
guard args.count >= 3, let pid = Int32(args[2]) else { fail("Required: inspect|click PID [NODE_PATH].") }
guard let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.google.Chrome" else {
    fail("PID must identify the explicit test Chrome application.")
}
func attr(_ node: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(node, name as CFString, &value) == .success else { return nil }
    return value
}
func children(_ node: AXUIElement) -> [AXUIElement] { attr(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func label(_ node: AXUIElement, _ name: String) -> String { attr(node, name).map { String(describing: $0) } ?? "" }
let root = AXUIElementCreateApplication(pid)
guard let windows = attr(root, kAXWindowsAttribute) as? [AXUIElement],
      let window = windows.first(where: { label($0, kAXTitleAttribute).contains("Toffee") }) else {
    fail("No accessible Toffee test window for this PID.")
}
var nodes: [[String: Any]] = []
func walk(_ node: AXUIElement, _ path: String, _ depth: Int) {
    if depth > 30 { return }
    let role = label(node, kAXRoleAttribute)
    let title = label(node, kAXTitleAttribute)
    let desc = label(node, kAXDescriptionAttribute)
    let value = label(node, kAXValueAttribute)
    if !title.isEmpty || !desc.isEmpty || !value.isEmpty || ["AXRow", "AXList", "AXTable", "AXDialog"].contains(role) {
        nodes.append(["path": path, "role": role, "title": title, "description": desc, "value": value,
                      "enabled": label(node, kAXEnabledAttribute)])
    }
    for (index, child) in children(node).enumerated() { walk(child, path + "." + String(index), depth + 1) }
}
if args[1] == "inspect" {
    walk(window, "w", 0)
    let data = try JSONSerialization.data(withJSONObject: nodes, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
} else if args[1] == "click" {
    guard args.count == 4, args[3].hasPrefix("w.") else { fail("Required explicit node path from inspection.") }
    var node = window
    for part in args[3].split(separator: ".").dropFirst() {
        let list = children(node)
        guard let index = Int(part), list.indices.contains(index) else { fail("Accessibility tree changed; inspect again.") }
        node = list[index]
    }
    var point = CGPoint.zero, size = CGSize.zero
    guard let p = attr(node, kAXPositionAttribute), let s = attr(node, kAXSizeAttribute),
          AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else {
        fail("Selected node has no rectangle.")
    }
    app.activate(options: [.activateIgnoringOtherApps])
    let center = CGPoint(x: point.x + size.width / 2, y: point.y + size.height / 2)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left)?.post(tap: .cghidEventTap)
    print("Clicked \(label(node, kAXRoleAttribute)) \(label(node, kAXTitleAttribute)) \(label(node, kAXValueAttribute))")
} else { fail("Unknown action.") }
