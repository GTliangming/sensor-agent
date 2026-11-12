# 《一屋百年》美术素材来源（临时美术）

> **临时网上素材，待 Tanaka 提供正式美术后替换。** 本文件记录的全部网上素材均为临时顶替 emoji 占位的过渡方案，不是正式美术；正式美术到位后按文末“替换方法”换掉，不要在任何文档里把这些素材写成“正式美术已完成”。

## 素材总览

| 来源 | 授权 | 物件数 | 备注 |
|---|---|---|---|
| game-icons.net（GitHub 仓库 game-icons/icons，2026-11-12 下载核验） | CC-BY 3.0（署名，见下） | 36 种物件 | 单色 SVG 路径图标，烘焙时按物件底色重着色 |
| emoji 占位（沿用旧流程烘焙） | 系统字体自带 | 5 种物件 | game-icons.net 没有合适图标，暂未替换 |

- 来源站：https://game-icons.net/（200，2026-11-12 核验）
- 仓库：https://github.com/game-icons/icons（master，tree sha `82d948812bfe3f269ef8f731dcdb07b08160edc4`，2026-11-12）
- 授权文本：https://raw.githubusercontent.com/game-icons/icons/master/license.txt —— “Icons provided under the Creative Commons 3.0 BY or CC0 if mentioned below.” 本批 36 个图标均属 CC-BY 3.0（无一标注 CC0），使用时须署名作者。
- 未花钱，未用授权不明的素材，未从其他游戏扒图，无水印。

## 署名（CC-BY 3.0 要求）

- **Delapouite**（http://delapouite.com）—— 26 个：耳机、书籍、纸箱、数据线、充电头、筷子、硬币、抱枕、文件袋、眼镜、衣架、奶茶杯、手机壳、旧报纸、本子、睡衣、塑料袋、遥控器、调料包、短裤、袜子、贴纸、外卖盒、T恤、U盘、水杯
- **Lorc**（http://lorcblog.blogspot.com）—— 7 个：气泡膜、快递单、钥匙、长裤、药瓶、笔、便利贴
- **Skoll** —— 1 个：手机膜
- **PriorBlue** —— 1 个：电池
- **Sbed**（http://opengameart.org/content/95-game-icons）—— 1 个：充电宝

## 逐物件来源（36 个已替换）

SVG 源文件在 `web/scripts/icon-sources/<物件ID>.svg`（原样保存，未改动）；映射关系在 `web/scripts/icon-sources.json`。图标页链接格式为 `https://game-icons.net/1x1/<作者>/<图标名>.html`（已抽查验证返回 200）。

| 物件 | game-icons 图标 | 作者 | 图标页 |
|---|---|---|---|
| 耳机 earphone | headphones | Delapouite | https://game-icons.net/1x1/delapouite/headphones.html |
| 药瓶 medicine_bottle | pill（胶囊，非瓶身，见“近似匹配”） | Lorc | https://game-icons.net/1x1/lorc/pill.html |
| 快递单 delivery_note | scroll-unfurled（展开的卷轴/纸单） | Lorc | https://game-icons.net/1x1/lorc/scroll-unfurled.html |
| 奶茶杯 milk_tea_cup | coffee-cup（带热气的杯子） | Delapouite | https://game-icons.net/1x1/delapouite/coffee-cup.html |
| 数据线 charging_cable | wire-coil（线圈） | Delapouite | https://game-icons.net/1x1/delapouite/wire-coil.html |
| 充电头 charging_head | plug（插头） | Delapouite | https://game-icons.net/1x1/delapouite/plug.html |
| 书籍 book | book-cover | Delapouite | https://game-icons.net/1x1/delapouite/book-cover.html |
| 本子 notebook | notebook | Delapouite | https://game-icons.net/1x1/delapouite/notebook.html |
| 外卖盒 takeaway_box | fast-noodles（方便面杯+筷子） | Delapouite | https://game-icons.net/1x1/delapouite/fast-noodles.html |
| 筷子 chopsticks | chopsticks | Delapouite | https://game-icons.net/1x1/delapouite/chopsticks.html |
| T恤 tshirt | t-shirt | Delapouite | https://game-icons.net/1x1/delapouite/t-shirt.html |
| 长裤 long_pants | trousers | Lorc | https://game-icons.net/1x1/lorc/trousers.html |
| 短裤 short_pants | shorts | Delapouite | https://game-icons.net/1x1/delapouite/shorts.html |
| 手机壳 mobile_case | smartphone | Delapouite | https://game-icons.net/1x1/delapouite/smartphone.html |
| 手机膜 mobile_screen_protector | tablet（平板状薄板） | Skoll | https://game-icons.net/1x1/skoll/tablet.html |
| 硬币 coin | coins（硬币堆） | Delapouite | https://game-icons.net/1x1/delapouite/coins.html |
| 遥控器 remote_control | tv-remote | Delapouite | https://game-icons.net/1x1/delapouite/tv-remote.html |
| 水杯 water_cup | water-bottle（水瓶+小杯） | Delapouite | https://game-icons.net/1x1/delapouite/water-bottle.html |
| 眼镜 glasses | sunglasses | Delapouite | https://game-icons.net/1x1/delapouite/sunglasses.html |
| 纸箱 carton | cardboard-box | Delapouite | https://game-icons.net/1x1/delapouite/cardboard-box.html |
| 气泡膜 bubble_wrap | bubbles（气泡簇） | Lorc | https://game-icons.net/1x1/lorc/bubbles.html |
| 钥匙 key | key | Lorc | https://game-icons.net/1x1/lorc/key.html |
| 袜子 sock | socks | Delapouite | https://game-icons.net/1x1/delapouite/socks.html |
| 抱枕 cushion | pillow | Delapouite | https://game-icons.net/1x1/delapouite/pillow.html |
| 睡衣 pajamas | kimono（和服式睡袍） | Delapouite | https://game-icons.net/1x1/delapouite/kimono.html |
| 衣架 hanger | hanger | Delapouite | https://game-icons.net/1x1/delapouite/hanger.html |
| 旧报纸 newspaper | newspaper | Delapouite | https://game-icons.net/1x1/delapouite/newspaper.html |
| 便利贴 sticky_note | folded-paper（折叠纸条） | Lorc | https://game-icons.net/1x1/lorc/folded-paper.html |
| 文件袋 file_bag | full-folder（文件夹） | Delapouite | https://game-icons.net/1x1/delapouite/full-folder.html |
| 笔 pen | fountain-pen（钢笔） | Lorc | https://game-icons.net/1x1/lorc/fountain-pen.html |
| U盘 usb_drive | usb-key | Delapouite | https://game-icons.net/1x1/delapouite/usb-key.html |
| 电池 battery | battery-100 | PriorBlue | https://game-icons.net/1x1/priorblue/battery-100.html |
| 充电宝 power_bank | battery-pack（带闪电的电池） | Sbed | https://game-icons.net/1x1/sbed/battery-pack.html |
| 塑料袋 plastic_bag | shopping-bag | Delapouite | https://game-icons.net/1x1/delapouite/shopping-bag.html |
| 调料包 sauce_packet | ketchup（番茄酱瓶） | Delapouite | https://game-icons.net/1x1/delapouite/ketchup.html |
| 贴纸 sticker | round-star（五角星） | Delapouite | https://game-icons.net/1x1/delapouite/round-star.html |

## 仍是 emoji 占位的 5 种物件及原因

| 物件 | emoji | 原因 |
|---|---|---|
| 胶带 tape | 🌀 | game-icons 只有卷尺（measure-tape）和警戒带（crime-scene-tape），都不是胶带卷 |
| 吸管 straw | 🥤 | 无吸管图标 |
| 发圈 hair_tie | ➰ | 无发圈/皮筋图标 |
| 纸巾 tissue | 🧻 | 无纸巾/面巾纸图标 |
| 鼠标 mouse | 🖱️ | game-icons 的 mouse 均是动物老鼠，无电脑鼠标 |

## 近似匹配（已替换但不是完全对物）

- 药瓶用了胶囊（pill）：更像“药”而不是“瓶”，但比心形药水瓶（health-potion，初选后弃用，像香水瓶）更易认。
- 快递单用了展开的卷轴（scroll-unfurled）：能认出是“一张纸单”，不是快递面单。
- 外卖盒用了方便面杯（fast-noodles）：认得出是外卖食物容器，不是盒子。
- 水杯用了水瓶（water-bottle）：瓶+杯组合，认得出是喝水容器。
- 手机膜用了平板（tablet）：一块平板状薄板，认得出是“一片屏幕类的东西”。
- 奶茶杯用了咖啡杯（coffee-cup）：杯子带热气，无吸管盖。
- 数据线用了线圈（wire-coil）：一卷线，认得出是线材。
- 气泡膜用了气泡簇（bubbles）：字面是气泡，不是膜。
- 调料包用了番茄酱瓶（ketchup）：酱料瓶，不是小包装袋。
- 便利贴用了折叠纸条（folded-paper）：折叠的纸，不是方形贴纸。
- 睡衣用了和服（kimono）：睡袍式样，不是睡衣套装。

## 替换方法（烘焙流程）

1. SVG 源文件放 `web/scripts/icon-sources/<物件ID>.svg`，映射写进 `web/scripts/icon-sources.json`（`sources.<物件ID> = { author, gameIcon }`，无映射的物件自动回落 emoji）。
2. `web/scripts/export-icons.ts` 烘焙：game-icons 的 SVG 统一是“黑底 + 白色图形”，脚本先去掉满幅黑底、把白图形改黑、按 viewBox 补宽高，再在无头 Chromium 里画成 256×256、按物件底色重着色（多变体先烘近白底再按变体色 multiply，单变体直接用默认变体色），加柔和投影，导出 WebP（质量 0.86）到 `web/public/sprites/<物件>__<变体>.webp`；同时按透明通道重算 48×48 掩码写入 `web/src/data/item_masks.json`。
3. 换图标后必须依次跑：`npm run export:icons` → `npm run gen:levels`（关卡按新掩码重算遮挡）→ `npm run validate:configs`（必须 0 错 0 警告）→ `npm test` → `npm run typecheck` → `npm run build`，有时间再跑 `npm run e2e`。
4. 文件名与变体 ID 的对应关系（67 个变体文件名）不要动；`items_ch01.json` 不要改（icon 字段仍是 emoji 占位，运行时不用它）。
5. 风格：单色扁平剪影 + 低饱和柔和底色（沿用 `items_ch01.json` 里的变体色），贴合“出租屋的凌晨”的治愈解压调性。白色/极浅色变体（耳机白、手机壳透明等）在浅色底衬上对比度偏低，是已知短板，正式美术时优先补。

## 场景底图不换

10 个场景已有程序化房间底衬（墙面带 + 地板带 + 家具剪影，见 `web/scripts/scene-specs.ts` 的 room 字段），本轮没有换成照片：照片风格与扁平图标不搭，且会显著增大包体。

## 正式美术来了怎么换

1. 把正式美术 PNG（透明底，见《美术规范文档》第 4 节）按 `<物件ID>__<变体ID>.webp` 命名放进 `web/public/sprites/`，或改 `export-icons.ts` 的绘制部分直接读美术 PNG；
2. 删掉 `icon-sources.json` 里对应的映射（或整文件），删掉 `icon-sources/` 里对应的 SVG；
3. 依次跑 `npm run export:icons` → `npm run gen:levels` → `npm run validate:configs` → `npm test` → `npm run typecheck` → `npm run build`（→ `npm run e2e`），全部通过才算换完；
4. 更新本文件：删掉已替换行的网上素材记录，写明正式美术来源与日期；本文件顶部“临时”声明在全部换完后删除。

## 验证记录（2026-11-12）

- `npm run export:icons`：41 个物件、67 张贴图（36 SVG + 5 emoji），sprites 由 845,706 B → 901,556 B（+55,850 B，+6.6%）
- `npm run gen:levels`：10 关重算，校验通过
- `npm run validate:configs`：10 关全 PASS，Errors 0，Warnings 0
- `npm test`：3 个文件，37 通过
- `npm run typecheck`：通过
- `npm run build`：通过，dist 由 1,712,852 B → 1,767,522 B（+54,670 B，+3.2%）
- `npm run e2e`：29 项全过
