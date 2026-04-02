import type { InstanceNode, RobloxPropertyValue } from "../types/roblox.js";

export function makeNode(
  name: string,
  className: string,
  children: InstanceNode[] = [],
  properties?: Record<string, RobloxPropertyValue>,
): InstanceNode {
  return {
    id: `id-${name}`,
    name,
    className,
    children,
    ...(properties !== undefined ? { properties } : {}),
  };
}

export function makeTree(extraChildren: InstanceNode[] = []): InstanceNode {
  return makeNode("game", "DataModel", [
    makeNode("Workspace", "Workspace", extraChildren),
    makeNode("ServerStorage", "ServerStorage"),
  ]);
}

export function makeSampleTree(): InstanceNode {
  const script = makeNode("GameManager", "Script", [], {
    Source: "-- manages game state\nlocal Players = game:GetService('Players')",
  });
  const button = makeNode("PlayButton", "TextButton");
  const workspace = makeNode("Workspace", "Workspace", [
    makeNode("Map", "Model", [makeNode("BasePart", "Part")]),
  ]);
  const starterGui = makeNode("StarterGui", "StarterGui", [button]);
  const serverStorage = makeNode("ServerStorage", "ServerStorage", [script]);
  return makeNode("game", "DataModel", [workspace, starterGui, serverStorage]);
}
