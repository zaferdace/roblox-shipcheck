import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  shop_name: z.string().default("Shop"),
  products: z
    .array(
      z.object({
        name: z.string(),
        price: z.number(),
        currency: z.string().default("Coins"),
        category: z.string().optional(),
      }),
    )
    .min(1),
  ui_style: z.enum(["grid", "list"]).default("grid"),
  studio_port: z.number().int().positive().default(33796),
});

registerTool({
  name: "rbx_shop_builder",
  description:
    "Build a functioning shop with UI, purchase flow, product config, and DataStore persistence",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const { products, ui_style } = input;
    const shop_name = input.shop_name;
    const shop_name_lua = escapeLuaString(shop_name);

    const productsLua = products
      .map((p, i) =>
        `  { id = "product_${i + 1}", name = "${escapeLuaString(p.name)}", price = ${p.price}, currency = "${escapeLuaString(p.currency)}", category = "${escapeLuaString(p.category ?? "General")}" }`,
      )
      .join(",\n");

    const shopModuleSource = `-- ${shop_name_lua} Module
local ShopModule = {}

local PRODUCTS = {
${productsLua},
}

function ShopModule.getProducts()
  return PRODUCTS
end

function ShopModule.getProduct(productId)
  for _, p in ipairs(PRODUCTS) do
    if p.id == productId then return p end
  end
  return nil
end

function ShopModule.canAfford(playerBalance, productId)
  local product = ShopModule.getProduct(productId)
  if not product then return false, "Product not found" end
  if (playerBalance[product.currency] or 0) < product.price then
    return false, "Insufficient " .. product.currency
  end
  return true
end

function ShopModule.purchase(playerBalance, productId)
  local canBuy, reason = ShopModule.canAfford(playerBalance, productId)
  if not canBuy then return false, reason end
  local product = ShopModule.getProduct(productId)
  playerBalance[product.currency] = (playerBalance[product.currency] or 0) - product.price
  return true, product
end

return ShopModule
`;

    await client.createInstance("ServerScriptService", "ModuleScript", shop_name);
    const shopModulePath = `ServerScriptService.${shop_name}`;
    await client.setScriptSource(shopModulePath, shopModuleSource);

    // Create RemoteEvents folder
    await client.createInstance("ReplicatedStorage", "Folder", `${shop_name}Remotes`);
    const remotesFolder = `ReplicatedStorage.${shop_name}Remotes`;

    await client.createInstance(remotesFolder, "RemoteEvent", "PurchaseRequest");
    await client.createInstance(remotesFolder, "RemoteEvent", "PurchaseResult");
    await client.createInstance(remotesFolder, "RemoteFunction", "GetProducts");

    const purchaseRequestPath = `${remotesFolder}.PurchaseRequest`;
    const purchaseResultPath = `${remotesFolder}.PurchaseResult`;

    // Server script for purchase validation
    const serverScriptSource = `-- ${shop_name_lua} Server Handler
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")

local remotes = ReplicatedStorage:WaitForChild("${shop_name_lua}Remotes")
local PurchaseRequest = remotes:WaitForChild("PurchaseRequest")
local PurchaseResult = remotes:WaitForChild("PurchaseResult")
local GetProducts = remotes:WaitForChild("GetProducts")
local ShopModule = require(game:GetService("ServerScriptService"):WaitForChild("${shop_name_lua}"))

local currencyStore = DataStoreService:GetDataStore("${shop_name_lua}Currency_v1")
local playerBalances = {}

local function loadBalance(player)
  local success, data = pcall(function()
    return currencyStore:GetAsync("player_" .. player.UserId)
  end)
  playerBalances[player.UserId] = (success and data) or { Coins = 100 }
end

local function saveBalance(player)
  local balance = playerBalances[player.UserId]
  if not balance then return end
  pcall(function()
    currencyStore:SetAsync("player_" .. player.UserId, balance)
  end)
end

Players.PlayerAdded:Connect(loadBalance)
Players.PlayerRemoving:Connect(function(player)
  saveBalance(player)
  playerBalances[player.UserId] = nil
end)

GetProducts.OnServerInvoke = function()
  return ShopModule.getProducts()
end

PurchaseRequest.OnServerEvent:Connect(function(player, productId)
  local balance = playerBalances[player.UserId]
  if not balance then
    PurchaseResult:FireClient(player, false, "Balance not loaded")
    return
  end
  local success, result = ShopModule.purchase(balance, productId)
  if success then
    saveBalance(player)
    PurchaseResult:FireClient(player, true, result)
  else
    PurchaseResult:FireClient(player, false, result)
  end
end)
`;

    await client.createInstance("ServerScriptService", "Script", `${shop_name}Server`);
    const serverScriptPath = `ServerScriptService.${shop_name}Server`;
    await client.setScriptSource(serverScriptPath, serverScriptSource);

    // Client-side LocalScript
    const isGrid = ui_style === "grid";
    const clientScriptSource = `-- ${shop_name_lua} Client
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local remotes = ReplicatedStorage:WaitForChild("${shop_name_lua}Remotes")
local PurchaseRequest = remotes:WaitForChild("PurchaseRequest")
local PurchaseResult = remotes:WaitForChild("PurchaseResult")
local GetProducts = remotes:WaitForChild("GetProducts")

local shopGui = playerGui:WaitForChild("${shop_name_lua}Gui")
local frame = shopGui:WaitForChild("${shop_name_lua}Frame")
local productContainer = frame:WaitForChild("ProductContainer")

local function createProductButton(product, parent)
  local btn = Instance.new("TextButton")
  btn.Name = product.id
  btn.Text = product.name .. "\\n" .. product.price .. " " .. product.currency
  btn.Size = ${isGrid ? 'UDim2.new(0.3, -4, 0.45, -4)' : 'UDim2.new(1, -8, 0, 60)'}
  btn.BackgroundColor3 = Color3.fromRGB(45, 45, 55)
  btn.TextColor3 = Color3.new(1, 1, 1)
  btn.Font = Enum.Font.GothamBold
  btn.TextSize = 14
  btn.Parent = parent
  btn.MouseButton1Click:Connect(function()
    PurchaseRequest:FireServer(product.id)
  end)
  return btn
end

local products = GetProducts:InvokeServer()
for _, product in ipairs(products) do
  createProductButton(product, productContainer)
end

PurchaseResult.OnClientEvent:Connect(function(success, data)
  if success then
    print("[${shop_name_lua}] Purchased:", data.name)
  else
    warn("[${shop_name_lua}] Purchase failed:", data)
  end
end)
`;

    await client.createInstance("StarterGui", "ScreenGui", `${shop_name}Gui`);
    const guiPath = `StarterGui.${shop_name}Gui`;

    await client.createInstance(guiPath, "LocalScript", `${shop_name}Client`);
    const clientScriptPath = `${guiPath}.${shop_name}Client`;
    await client.setScriptSource(clientScriptPath, clientScriptSource);

    await client.createInstance(guiPath, "Frame", `${shop_name}Frame`);
    const framePath = `${guiPath}.${shop_name}Frame`;
    await client.setInstanceProperty(framePath, "Size", {
      X: { Scale: 0.5, Offset: 0 },
      Y: { Scale: 0.7, Offset: 0 },
    });
    await client.setInstanceProperty(framePath, "Position", {
      X: { Scale: 0.25, Offset: 0 },
      Y: { Scale: 0.15, Offset: 0 },
    });
    await client.setInstanceProperty(framePath, "BackgroundColor3", [0.08, 0.08, 0.12]);

    await client.createInstance(framePath, "TextLabel", "Title");
    const titlePath = `${framePath}.Title`;
    await client.setInstanceProperty(titlePath, "Text", shop_name);
    await client.setInstanceProperty(titlePath, "Size", {
      X: { Scale: 1, Offset: 0 },
      Y: { Scale: 0.08, Offset: 0 },
    });
    await client.setInstanceProperty(titlePath, "TextColor3", [1, 1, 1]);
    await client.setInstanceProperty(titlePath, "Font", "GothamBold");
    await client.setInstanceProperty(titlePath, "TextSize", 20);
    await client.setInstanceProperty(titlePath, "BackgroundTransparency", 1);

    await client.createInstance(framePath, "ScrollingFrame", "ProductContainer");
    const containerPath = `${framePath}.ProductContainer`;
    await client.setInstanceProperty(containerPath, "Size", {
      X: { Scale: 1, Offset: 0 },
      Y: { Scale: 0.9, Offset: 0 },
    });
    await client.setInstanceProperty(containerPath, "Position", {
      X: { Scale: 0, Offset: 0 },
      Y: { Scale: 0.08, Offset: 0 },
    });
    await client.setInstanceProperty(containerPath, "BackgroundTransparency", 1);
    await client.setInstanceProperty(containerPath, "ScrollBarThickness", 6);

    const layoutClass = isGrid ? "UIGridLayout" : "UIListLayout";
    await client.createInstance(containerPath, layoutClass, "Layout");

    return createResponseEnvelope(
      {
        shop_path: shopModulePath,
        products_count: products.length,
        created: {
          server_script: serverScriptPath,
          client_script: clientScriptPath,
          ui: guiPath,
          remotes: [purchaseRequestPath, purchaseResultPath],
        },
      },
      { source: sourceInfo({ studio_port: input.studio_port }) },
    );
  },
});
