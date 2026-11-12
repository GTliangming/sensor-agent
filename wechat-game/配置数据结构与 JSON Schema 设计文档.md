# 一屋百年 — 配置数据结构与 JSON Schema 设计文档

- **版本：** v1.0
- **状态：** 设计初稿，待核心规则确认
- **适用项目：** 微信小游戏《一屋百年》
- **技术环境：** Cocos Creator 3.8.8 + TypeScript
- **配置格式：** JSON
- **数据校验：** JSON Schema Draft 2020-12 + TypeScript 业务校验器

> 2026-11-11：本文内容已并入《数据结构设计文档》，Web 原型的实际字段与约定见其第十九章。
> 当前实现用 TypeScript 校验器（`web/src/core/validator.ts`）完成结构与业务校验，暂未接入 Ajv。

# 一、设计目标

本项目采用数据驱动的关卡设计方式。

游戏玩法逻辑由 TypeScript 实现，物件、场景、章节、关卡等内容通过 JSON 配置管理。

目标是：

1. 新增普通物件时，尽量只需要增加物件配置和美术资源。
2. 新增普通关卡时，尽量只需要编写关卡 JSON，不需要修改核心代码。
3. 新增章节时，可以复用已有的场景、物件和关卡系统。
4. 所有配置在开发阶段自动校验，尽早发现数据错误。
5. 遮挡关系、物件数量、资源引用、关卡可完成性都必须能够自动检查。
6. 为后续关卡编辑器和批量生产关卡预留扩展能力。

**核心原则：**

- JSON Schema 负责检查数据格式。
- TypeScript 校验器负责检查业务规则。
- 关卡可完成性检查负责检查关卡是否真的能够通关。
- 不允许将关键玩法规则交给配置数据自由决定。
- 不允许 Claude Code 擅自修改已经确认的玩法规则。

# 二、已确认的玩法规则

以下内容来自当前已经确认的玩法决策。

| 规则                   | 当前决策                       |
| ---------------------- | ------------------------------ |
| 正确物件               | 匹配后立即清除                 |
| 正确物件是否进入归位格 | 不进入                         |
| 目标计数               | 按品类计数（具体语义仍需确认） |
| 错误物件               | 占用归位格                     |
| 归位格满               | 暂停游戏，选择救场或重开       |
| 遮挡关系               | 手动配置 + 程序检查            |
| 物件布局               | 手动摆放 + 锚点辅助            |
| 广告                   | 第一版模拟，不接入真实广告     |
| 坐标                   | 设计分辨率像素坐标             |

## 2.1 正确物件拾取流程

玩家点击物件后：

1. 检查物件是否可以点击。
2. 检查物件是否被其他物件遮挡。
3. 判断物件是否符合当前目标。
4. 如果正确：
   - 锁定当前物件，防止重复点击。
   - 播放物件飞向目标格的动画。
   - 对应目标进度增加 1。
   - 从场景中移除物件。
   - 检查是否完成全部目标。
5. 如果错误：
   - 检查归位格是否有空位。
   - 将物件放入归位格。
   - 归位格占用数量增加 1。
   - 不增加任何目标进度。

正确物件不进入归位格，错误物件才会占用归位格。

## 2.2 运行时状态

物件静态配置不记录正确或错误状态。

运行时根据物件所属目标进行匹配。

```
export interface ObjectiveProgress {
  itemId: string;
  requiredCount: number;
  collectedCount: number;
  completed: boolean;
}

export type ItemInstanceStatus =
  | 'available'
  | 'pending_pickup'
  | 'removed'
  | 'in_collection';

export interface RuntimeItemInstance {
  id: string;
  itemId: string;
  variantId: string;
  status: ItemInstanceStatus;
}

export interface CollectionSlotState {
  slotIndex: number;
  itemInstanceId: string | null;
  itemId: string | null;
  occupied: boolean;
}
```

注意：以上 `ObjectiveProgress.itemId` 是当前临时数据模型。由于目标计数的“按品类”定义还没有完全明确，后续可能需要调整为 `category` 或其他目标标识。

# 三、配置文件目录结构

建议统一放在：

```
assets/resources/configs/
assets/
└── resources/
    └── configs/
        ├── schema/
        │   ├── item.schema.json
        │   ├── level.schema.json
        │   ├── chapter.schema.json
        │   └── scene.schema.json
        │
        ├── items/
        │   └── items_ch01.json
        │
        ├── chapters/
        │   └── chapter_01.json
        │
        ├── scenes/
        │   └── scenes_ch01.json
        │
        └── levels/
            ├── level_001.json
            ├── level_002.json
            ├── level_003.json
            ├── level_004.json
            ├── level_005.json
            ├── level_006.json
            ├── level_007.json
            ├── level_008.json
            ├── level_009.json
            └── level_010.json
```

TypeScript 数据模块建议：

```
assets/scripts/data/
├── types/
│   ├── item.types.ts
│   ├── level.types.ts
│   ├── chapter.types.ts
│   └── scene.types.ts
│
├── loader/
│   └── ConfigLoader.ts
│
├── validator/
│   ├── SchemaValidator.ts
│   ├── ConfigValidator.ts
│   ├── ReferenceValidator.ts
│   ├── LevelValidator.ts
│   └── PlayabilityValidator.ts
│
└── index.ts
```

# 四、物件数据结构 item.schema.json

## 4.1 设计目的

用于定义游戏中所有可以被玩家寻找、点击和收集的物件。

例如：

- 耳机
- 手机
- 奶茶杯
- 快递盒
- T 恤
- 数据线
- 充电头
- 遥控器

物件配置属于全局资源数据，不应该在每个关卡中重复定义物件基础信息。

关卡只需要引用物件 ID。

## 4.2 字段定义

| 字段             | 类型   | 必填 | 说明           |
| ---------------- | ------ | ---- | -------------- |
| id               | string | 是   | 物件唯一 ID    |
| name             | string | 是   | 物件名称       |
| category         | string | 是   | 物件所属分类   |
| description      | string | 否   | 物件描述       |
| size             | object | 是   | 物件默认尺寸   |
| variants         | array  | 是   | 物件外观变体   |
| defaultVariantId | string | 是   | 默认变体 ID    |
| allowedZones     | array  | 是   | 允许出现的区域 |
| hitArea          | object | 否   | 点击区域       |
| tags             | array  | 是   | 物件标签       |

## 4.3 Schema 文件

文件名：`item.schema.json`

```
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://yibaiwan.local/schema/item.schema.json",
  "title": "Item Config",
  "description": "游戏物件配置",
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/Item"
      }
    }
  },
  "additionalProperties": false,
  "$defs": {
    "Item": {
      "type": "object",
      "required": [
        "id",
        "name",
        "category",
        "size",
        "variants",
        "defaultVariantId",
        "allowedZones",
        "tags"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "category": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "type": "string"
        },
        "size": {
          "$ref": "#/$defs/Size"
        },
        "variants": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/ItemVariant"
          }
        },
        "defaultVariantId": {
          "type": "string",
          "minLength": 1
        },
        "allowedZones": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true
        },
        "hitArea": {
          "$ref": "#/$defs/HitArea"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      "additionalProperties": false
    },
    "Size": {
      "type": "object",
      "required": [
        "width",
        "height"
      ],
      "properties": {
        "width": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "height": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "additionalProperties": false
    },
    "ItemVariant": {
      "type": "object",
      "required": [
        "id",
        "image"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "image": {
          "type": "string",
          "minLength": 1
        },
        "displayName": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "HitArea": {
      "type": "object",
      "required": [
        "x",
        "y",
        "width",
        "height"
      ],
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "width": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "height": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "additionalProperties": false
    }
  }
}
```

## 4.4 物件配置示例

文件名：`items_ch01.json`

```
{
  "items": [
    {
      "id": "headphones",
      "name": "耳机",
      "category": "electronics",
      "description": "日常使用的有线或无线耳机",
      "size": {
        "width": 120,
        "height": 90
      },
      "variants": [
        {
          "id": "black",
          "image": "items/headphones/headphones_black",
          "displayName": "黑色耳机"
        },
        {
          "id": "white",
          "image": "items/headphones/headphones_white",
          "displayName": "白色耳机"
        }
      ],
      "defaultVariantId": "black",
      "allowedZones": [
        "desktop",
        "bedside",
        "sofa"
      ],
      "hitArea": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 90
      },
      "tags": [
        "electronics",
        "daily",
        "small"
      ]
    }
  ]
}
```

## 4.5 额外业务校验

JSON Schema 无法完成以下检查，需要 TypeScript 校验器：

1. 物件 ID 全局唯一。
2. variants 内部 ID 唯一。
3. defaultVariantId 必须存在于 variants 中。
4. 物件图片资源必须真实存在。
5. allowedZones 的语义必须统一。
6. HitArea 不应超出物件实际尺寸，除非明确允许。
7. 同一物件不能出现重复的变体 ID。

**待确认：**

`allowedZones` 当前采用场景区域 ID，例如 `desktop`、`bedside`。

如果不同章节的场景区域命名不统一，全局物件库就会受到具体场景命名约束。

后续可以考虑改为：

- `allowedZoneTags`：允许出现的区域标签。
- 或保留 `allowedZones`，但制定全项目统一的区域 ID 规范。

在统一规则之前，不要大规模录入物件数据。

# 五、关卡数据结构 level.schema.json

## 5.1 设计目的

每一个关卡通过独立 JSON 文件管理。

关卡配置主要包含：

- 关卡基础信息
- 关卡所属章节
- 场景引用
- 难度
- 目标物件
- 场景中的物件实例
- 遮挡关系
- 找寻格和归位格
- 机制配置
- 提示配置
- 通关配置

关卡配置不重复定义物件基础属性。

## 5.2 字段定义

| 字段             | 类型   | 必填 | 说明           |
| ---------------- | ------ | ---- | -------------- |
| id               | string | 是   | 关卡 ID        |
| chapterId        | string | 是   | 所属章节       |
| levelNumber      | number | 是   | 章节内关卡序号 |
| name             | string | 是   | 关卡名称       |
| sceneId          | string | 是   | 使用的场景     |
| difficulty       | number | 是   | 难度数值       |
| designResolution | object | 是   | 关卡设计分辨率 |
| objectives       | array  | 是   | 寻找目标       |
| itemInstances    | array  | 是   | 场景物件实例   |
| gridConfig       | object | 是   | 格子配置       |
| mechanicConfig   | object | 是   | 特殊机制       |
| hintConfig       | object | 是   | 提示配置       |
| completionConfig | object | 是   | 通关配置       |

## 5.3 Schema 文件

文件名：`level.schema.json`

```
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://yibaiwan.local/schema/level.schema.json",
  "title": "Level Config",
  "description": "关卡配置",
  "type": "object",
  "required": [
    "id",
    "chapterId",
    "levelNumber",
    "name",
    "sceneId",
    "difficulty",
    "designResolution",
    "objectives",
    "itemInstances",
    "gridConfig",
    "mechanicConfig",
    "hintConfig",
    "completionConfig"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    },
    "chapterId": {
      "type": "string",
      "minLength": 1
    },
    "levelNumber": {
      "type": "integer",
      "minimum": 1
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "sceneId": {
      "type": "string",
      "minLength": 1
    },
    "difficulty": {
      "type": "number",
      "minimum": 0
    },
    "designResolution": {
      "$ref": "#/$defs/Resolution"
    },
    "objectives": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/Objective"
      }
    },
    "itemInstances": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/ItemInstance"
      }
    },
    "gridConfig": {
      "$ref": "#/$defs/GridConfig"
    },
    "mechanicConfig": {
      "$ref": "#/$defs/MechanicConfig"
    },
    "hintConfig": {
      "$ref": "#/$defs/HintConfig"
    },
    "completionConfig": {
      "$ref": "#/$defs/CompletionConfig"
    }
  },
  "additionalProperties": false,
  "$defs": {
    "Resolution": {
      "type": "object",
      "required": [
        "width",
        "height"
      ],
      "properties": {
        "width": {
          "type": "integer",
          "minimum": 1
        },
        "height": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    },
    "Objective": {
      "type": "object",
      "required": [
        "itemId",
        "requiredCount"
      ],
      "properties": {
        "itemId": {
          "type": "string",
          "minLength": 1
        },
        "requiredCount": {
          "type": "integer",
          "minimum": 1
        },
        "displayVariant": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "ItemInstance": {
      "type": "object",
      "required": [
        "id",
        "itemId",
        "variantId",
        "position",
        "rotation",
        "scale",
        "layer",
        "zone",
        "blocking"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "itemId": {
          "type": "string",
          "minLength": 1
        },
        "variantId": {
          "type": "string",
          "minLength": 1
        },
        "position": {
          "$ref": "#/$defs/Position"
        },
        "rotation": {
          "type": "number"
        },
        "scale": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "layer": {
          "type": "integer",
          "minimum": 0
        },
        "zone": {
          "type": "string",
          "minLength": 1
        },
        "blocking": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true
        }
      },
      "additionalProperties": false
    },
    "Position": {
      "type": "object",
      "required": [
        "x",
        "y"
      ],
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      },
      "additionalProperties": false
    },
    "GridConfig": {
      "type": "object",
      "required": [
        "targetSlots",
        "collectionSlots",
        "adConfig"
      ],
      "properties": {
        "targetSlots": {
          "$ref": "#/$defs/TargetSlots"
        },
        "collectionSlots": {
          "$ref": "#/$defs/CollectionSlots"
        },
        "adConfig": {
          "$ref": "#/$defs/GridAdConfig"
        }
      },
      "additionalProperties": false
    },
    "TargetSlots": {
      "type": "object",
      "required": [
        "baseCount",
        "maxCount"
      ],
      "properties": {
        "baseCount": {
          "type": "integer",
          "minimum": 1
        },
        "maxCount": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    },
    "CollectionSlots": {
      "type": "object",
      "required": [
        "capacity"
      ],
      "properties": {
        "capacity": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    },
    "GridAdConfig": {
      "type": "object",
      "required": [
        "enabled",
        "simulated",
        "unlockableTargetSlots"
      ],
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "simulated": {
          "type": "boolean"
        },
        "unlockableTargetSlots": {
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1
          },
          "uniqueItems": true
        }
      },
      "additionalProperties": false
    },
    "MechanicConfig": {
      "type": "object",
      "required": [
        "enabled",
        "mechanics"
      ],
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "mechanics": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Mechanic"
          }
        }
      },
      "additionalProperties": false
    },
    "Mechanic": {
      "type": "object",
      "required": [
        "type",
        "enabled"
      ],
      "properties": {
        "type": {
          "type": "string",
          "minLength": 1
        },
        "enabled": {
          "type": "boolean"
        },
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "additionalProperties": false
    },
    "HintConfig": {
      "type": "object",
      "required": [
        "enabled",
        "maxFreeUses",
        "cooldownSeconds",
        "highlightDuration"
      ],
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "maxFreeUses": {
          "type": "integer",
          "minimum": 0
        },
        "cooldownSeconds": {
          "type": "number",
          "minimum": 0
        },
        "highlightDuration": {
          "type": "number",
          "minimum": 0
        }
      },
      "additionalProperties": false
    },
    "CompletionConfig": {
      "type": "object",
      "required": [
        "requireAllObjectivesCompleted",
        "showCompletionAnimation"
      ],
      "properties": {
        "requireAllObjectivesCompleted": {
          "type": "boolean"
        },
        "showCompletionAnimation": {
          "type": "boolean"
        },
        "nextLevelId": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  }
}
```

## 5.4 关卡配置示例

文件名：`level_001.json`

以下仅展示结构，不代表第一关最终物件数量和位置。

```
{
  "id": "level_001",
  "chapterId": "chapter_01",
  "levelNumber": 1,
  "name": "床头柜",
  "sceneId": "scene_rental_room",
  "difficulty": 1,
  "designResolution": {
    "width": 1080,
    "height": 1920
  },
  "objectives": [
    {
      "itemId": "headphones",
      "requiredCount": 1,
      "displayVariant": "black"
    }
  ],
  "itemInstances": [
    {
      "id": "instance_headphones_001",
      "itemId": "headphones",
      "variantId": "black",
      "position": {
        "x": 420,
        "y": 760
      },
      "rotation": 0,
      "scale": 1,
      "layer": 1,
      "zone": "bedside",
      "blocking": []
    }
  ],
  "gridConfig": {
    "targetSlots": {
      "baseCount": 2,
      "maxCount": 3
    },
    "collectionSlots": {
      "capacity": 3
    },
    "adConfig": {
      "enabled": false,
      "simulated": true,
      "unlockableTargetSlots": []
    }
  },
  "mechanicConfig": {
    "enabled": false,
    "mechanics": []
  },
  "hintConfig": {
    "enabled": true,
    "maxFreeUses": 1,
    "cooldownSeconds": 10,
    "highlightDuration": 2
  },
  "completionConfig": {
    "requireAllObjectivesCompleted": true,
    "showCompletionAnimation": true,
    "nextLevelId": "level_002"
  }
}
```

## 5.5 遮挡关系定义

`blocking` 表示：

**当前物件被哪些其他物件遮挡。**

例如：

```
{
  "id": "instance_book",
  "blocking": [
    "instance_phone",
    "instance_cup"
  ]
}
```

含义是：

- 手机遮挡书本。
- 奶茶杯遮挡书本。
- 手机和奶茶杯都移除后，书本才能点击。

程序必须检查：

1. blocking 引用的实例是否存在。
2. 是否存在自身遮挡自身。
3. 是否存在循环遮挡。
4. 被遮挡物件是否能够通过正常操作解除遮挡。
5. 不允许出现无法解除的遮挡死锁。

**特别注意：**

代码实现必须遵循上述方向，不要将 blocking 错误理解为“当前物件遮挡了哪些物件”。

## 5.6 关卡业务校验

JSON Schema 之外，还需要检查：

1. 关卡 ID 唯一。
2. itemInstances 中实例 ID 唯一。
3. objectives 引用的物件必须存在。
4. itemInstances 引用的物件必须存在。
5. variantId 必须属于对应物件。
6. 每个目标需要的数量必须能够满足。
7. 遮挡关系引用必须存在。
8. 遮挡关系不能自引用。
9. 遮挡关系不能成环。
10. zone 必须存在于对应场景。
11. 所有物件坐标不能超出设计画布，除非明确允许。
12. targetSlots.maxCount 必须大于或等于 baseCount。
13. unlockableTargetSlots 必须在合法范围内。
14. nextLevelId 必须指向有效关卡。
15. 关卡引用的 sceneId 必须存在。
16. 关卡设计分辨率必须与场景设计分辨率一致。

还必须检查关卡可完成性：

- 所有目标物件都能被找到。
- 目标物件没有被永久遮挡。
- 错误物件不会导致必然无法完成。
- 所有目标都能按照遮挡解除顺序被正常获取。
- 目标数量和实例数量能够对应。

# 六、章节数据结构 chapter.schema.json

## 6.1 设计目的

章节用于组织关卡。

每个章节包含：

- 章节 ID
- 章节序号
- 章节名称
- 章节描述
- 章节封面
- 章节场景
- 章节关卡列表
- 章节解锁条件

## 6.2 字段定义

| 字段            | 类型   | 必填 | 说明         |
| --------------- | ------ | ---- | ------------ |
| id              | string | 是   | 章节 ID      |
| chapterNumber   | number | 是   | 章节序号     |
| name            | string | 是   | 章节名称     |
| description     | string | 是   | 章节描述     |
| coverImage      | string | 是   | 章节封面     |
| sceneId         | string | 是   | 默认场景 ID  |
| levelIds        | array  | 是   | 关卡 ID 列表 |
| unlockCondition | object | 是   | 解锁条件     |

## 6.3 Schema 文件

文件名：`chapter.schema.json`

```
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://yibaiwan.local/schema/chapter.schema.json",
  "title": "Chapter Config",
  "description": "章节配置",
  "type": "object",
  "required": [
    "id",
    "chapterNumber",
    "name",
    "description",
    "coverImage",
    "sceneId",
    "levelIds",
    "unlockCondition"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    },
    "chapterNumber": {
      "type": "integer",
      "minimum": 1
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string"
    },
    "coverImage": {
      "type": "string",
      "minLength": 1
    },
    "sceneId": {
      "type": "string",
      "minLength": 1
    },
    "levelIds": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true
    },
    "unlockCondition": {
      "oneOf": [
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "const": "none"
            }
          },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": [
            "type",
            "requiredChapterId"
          ],
          "properties": {
            "type": {
              "const": "previous_chapter_completed"
            },
            "requiredChapterId": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": false
        }
      ]
    }
  },
  "additionalProperties": false
}
```

## 6.4 章节配置示例

文件名：`chapter_01.json`

```
{
  "id": "chapter_01",
  "chapterNumber": 1,
  "name": "出租屋的凌晨",
  "description": "从一个普通的出租屋开始，寻找生活中被遗忘的物件。",
  "coverImage": "chapters/chapter_01/cover",
  "sceneId": "scene_rental_room",
  "levelIds": [
    "level_001",
    "level_002",
    "level_003",
    "level_004",
    "level_005",
    "level_006",
    "level_007",
    "level_008",
    "level_009",
    "level_010"
  ],
  "unlockCondition": {
    "type": "none"
  }
}
```

## 6.5 章节业务校验

1. 章节 ID 全局唯一。
2. chapterNumber 不重复。
3. sceneId 必须存在。
4. levelIds 中的所有关卡必须存在。
5. 所有关卡的 chapterId 必须与当前章节一致。
6. 关卡顺序必须符合章节顺序设计。
7. requiredChapterId 必须存在。
8. 章节解锁关系不能形成循环。
9. 章节封面资源必须存在。

# 七、场景数据结构 scene.schema.json

## 7.1 设计目的

场景用于定义关卡的背景和可摆放区域。

一个场景可以被多个关卡复用。

例如第一章可以共用一个出租屋场景，但不同关卡摆放不同物件、改变遮挡关系。

场景配置包含：

- 场景 ID
- 场景名称
- 背景图
- 设计分辨率
- 区域 zones
- 布局锚点 anchors

## 7.2 字段定义

| 字段             | 类型   | 必填 | 说明         |
| ---------------- | ------ | ---- | ------------ |
| id               | string | 是   | 场景 ID      |
| name             | string | 是   | 场景名称     |
| background       | string | 是   | 背景资源路径 |
| designResolution | object | 是   | 设计分辨率   |
| zones            | array  | 是   | 可摆放区域   |
| anchors          | array  | 否   | 布局辅助锚点 |

## 7.3 Schema 文件

文件名：`scene.schema.json`

```
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://yibaiwan.local/schema/scene.schema.json",
  "title": "Scene Config",
  "description": "游戏场景配置",
  "type": "object",
  "required": [
    "scenes"
  ],
  "properties": {
    "scenes": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/Scene"
      }
    }
  },
  "additionalProperties": false,
  "$defs": {
    "Scene": {
      "type": "object",
      "required": [
        "id",
        "name",
        "background",
        "designResolution",
        "zones"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "background": {
          "type": "string",
          "minLength": 1
        },
        "designResolution": {
          "$ref": "#/$defs/Resolution"
        },
        "zones": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/SceneZone"
          }
        },
        "anchors": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/SceneAnchor"
          }
        }
      },
      "additionalProperties": false
    },
    "Resolution": {
      "type": "object",
      "required": [
        "width",
        "height"
      ],
      "properties": {
        "width": {
          "type": "integer",
          "minimum": 1
        },
        "height": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    },
    "SceneZone": {
      "type": "object",
      "required": [
        "id",
        "name"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "bounds": {
          "$ref": "#/$defs/Bounds"
        }
      },
      "additionalProperties": false
    },
    "Bounds": {
      "type": "object",
      "required": [
        "x",
        "y",
        "width",
        "height"
      ],
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "width": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "height": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "additionalProperties": false
    },
    "SceneAnchor": {
      "type": "object",
      "required": [
        "id",
        "name",
        "position",
        "type"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "position": {
          "$ref": "#/$defs/Position"
        },
        "type": {
          "type": "string",
          "minLength": 1
        }
      },
      "additionalProperties": false
    },
    "Position": {
      "type": "object",
      "required": [
        "x",
        "y"
      ],
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  }
}
```

## 7.4 场景配置示例

文件名：`scenes_ch01.json`

```
{
  "scenes": [
    {
      "id": "scene_rental_room",
      "name": "出租屋卧室",
      "background": "scenes/rental_room/background",
      "designResolution": {
        "width": 1080,
        "height": 1920
      },
      "zones": [
        {
          "id": "bedside",
          "name": "床头柜区域",
          "bounds": {
            "x": 100,
            "y": 600,
            "width": 500,
            "height": 400
          }
        },
        {
          "id": "desktop",
          "name": "桌面区域",
          "bounds": {
            "x": 100,
            "y": 1000,
            "width": 880,
            "height": 500
          }
        },
        {
          "id": "sofa",
          "name": "沙发区域",
          "bounds": {
            "x": 100,
            "y": 300,
            "width": 880,
            "height": 500
          }
        }
      ],
      "anchors": [
        {
          "id": "anchor_bedside_center",
          "name": "床头柜中心",
          "position": {
            "x": 350,
            "y": 800
          },
          "type": "center"
        },
        {
          "id": "anchor_desktop_center",
          "name": "桌面中心",
          "position": {
            "x": 540,
            "y": 1250
          },
          "type": "center"
        }
      ]
    }
  ]
}
```

## 7.5 场景业务校验

1. 场景 ID 全局唯一。
2. zone ID 在场景内唯一。
3. anchor ID 在场景内唯一。
4. 背景图资源必须存在。
5. zone bounds 不能超出设计画布。
6. anchor position 不能超出设计画布。
7. 关卡引用的 sceneId 必须存在。
8. 关卡物件实例的 zone 必须存在于对应场景。
9. 场景分辨率必须与使用它的关卡一致。

# 八、跨文件引用关系

四种配置不是独立存在的。

它们之间存在明确引用关系。

```
Chapter
  │
  ├── sceneId ───────────────> Scene
  │
  └── levelIds
        │
        ▼
       Level
        │
        ├── chapterId ───────> Chapter
        │
        ├── sceneId ─────────> Scene
        │
        ├── objectives
        │     └── itemId ────> Item
        │
        └── itemInstances
              ├── itemId ────> Item
              ├── variantId ─> Item.variants
              └── zone ──────> Scene.zones
```

必须建立统一的配置索引：

```
export interface ConfigIndex {
  items: Map<string, ItemConfig>;
  scenes: Map<string, SceneConfig>;
  chapters: Map<string, ChapterConfig>;
  levels: Map<string, LevelConfig>;
}
```

通过索引快速完成跨文件引用检查。

# 九、TypeScript 类型定义

Schema 校验负责检查 JSON 格式。

TypeScript 类型负责约束业务代码中的数据使用。

建议根据最终 Schema 编写对应类型。

## 9.1 Item 类型

```
export interface ItemConfig {
  id: string;
  name: string;
  category: string;
  description?: string;
  size: {
    width: number;
    height: number;
  };
  variants: ItemVariant[];
  defaultVariantId: string;
  allowedZones: string[];
  hitArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  tags: string[];
}

export interface ItemVariant {
  id: string;
  image: string;
  displayName?: string;
}
```

## 9.2 Level 类型

```
export interface LevelConfig {
  id: string;
  chapterId: string;
  levelNumber: number;
  name: string;
  sceneId: string;
  difficulty: number;
  designResolution: {
    width: number;
    height: number;
  };
  objectives: ObjectiveConfig[];
  itemInstances: ItemInstanceConfig[];
  gridConfig: GridConfig;
  mechanicConfig: MechanicConfig;
  hintConfig: HintConfig;
  completionConfig: CompletionConfig;
}

export interface ObjectiveConfig {
  itemId: string;
  requiredCount: number;
  displayVariant?: string;
}

export interface ItemInstanceConfig {
  id: string;
  itemId: string;
  variantId: string;
  position: {
    x: number;
    y: number;
  };
  rotation: number;
  scale: number;
  layer: number;
  zone: string;
  blocking: string[];
}
```

## 9.3 Chapter 类型

```
export interface ChapterConfig {
  id: string;
  chapterNumber: number;
  name: string;
  description: string;
  coverImage: string;
  sceneId: string;
  levelIds: string[];
  unlockCondition:
    | {
        type: 'none';
      }
    | {
        type: 'previous_chapter_completed';
        requiredChapterId: string;
      };
}
```

## 9.4 Scene 类型

```
export interface SceneConfig {
  id: string;
  name: string;
  background: string;
  designResolution: {
    width: number;
    height: number;
  };
  zones: SceneZone[];
  anchors?: SceneAnchor[];
}

export interface SceneZone {
  id: string;
  name: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SceneAnchor {
  id: string;
  name: string;
  position: {
    x: number;
    y: number;
  };
  type: string;
}
```

注意：以上类型必须与最终 Schema 保持一致，不允许出现两套互相冲突的定义。

# 十、配置校验系统

## 10.1 为什么需要两种校验

JSON Schema 只能判断字段格式是否正确。

例如：

```
{
  "itemId": "headphones",
  "requiredCount": 3
}
```

Schema 可以判断：

- itemId 是不是字符串。
- requiredCount 是不是正整数。

但 Schema 无法判断：

- headphones 是否真实存在。
- 关卡中是否真的摆放了 3 个耳机。
- 耳机是否被永久遮挡。
- 场景是否存在。
- 遮挡关系是否形成循环。

所以必须同时开发业务校验器。

## 10.2 校验流程

```
读取所有 JSON 配置
        │
        ▼
JSON 解析
        │
        ▼
JSON Schema 校验
        │
        ▼
唯一 ID 校验
        │
        ▼
跨文件引用校验
        │
        ▼
资源路径校验
        │
        ▼
关卡业务规则校验
        │
        ▼
遮挡关系校验
        │
        ▼
关卡可完成性检查
        │
        ▼
输出校验报告
```

任何阻断级错误都必须导致校验失败。

## 10.3 校验器职责

### SchemaValidator.ts

负责：

- 加载 JSON Schema。
- 使用 Ajv 校验 JSON。
- 输出字段路径和错误信息。

### ReferenceValidator.ts

负责：

- 物件 ID 引用。
- 场景 ID 引用。
- 章节 ID 引用。
- 关卡 ID 引用。
- 变体 ID 引用。
- zone ID 引用。

### LevelValidator.ts

负责：

- 实例 ID 唯一。
- 目标数量检查。
- 遮挡引用检查。
- 坐标边界检查。
- 格子容量检查。
- 关卡基础业务规则检查。

### PlayabilityValidator.ts

负责：

- 检查目标是否能够全部找到。
- 检查遮挡是否能够正常解除。
- 检查是否存在永久不可点击物件。
- 检查错误物件是否可能造成必然失败。
- 检查是否存在不可完成的关卡布局。

## 10.4 推荐使用 Ajv

安装：

```
npm install ajv ajv-formats
```

开发阶段执行：

```
npm run validate:configs
```

建议将校验命令加入 package.json：

```
{
  "scripts": {
    "validate:configs": "tsx scripts/validate-configs.ts"
  }
}
```

具体执行环境需要结合当前 Cocos Creator 项目实际的 Node、TypeScript 和脚本运行方式确定。如果不适合使用 tsx，可采用独立 Node.js 校验脚本。

## 10.5 校验报告示例

```
========== Config Validation ==========

[PASS] item.schema.json
[PASS] level.schema.json
[PASS] chapter.schema.json
[PASS] scene.schema.json

[PASS] Item ID uniqueness
[PASS] Scene ID uniqueness
[PASS] Chapter ID uniqueness
[PASS] Level ID uniqueness

[ERROR] level_003.json
  itemInstances[2].itemId
  Unknown item: unknown_item

[ERROR] level_005.json
  itemInstances[4].blocking
  Unknown instance: instance_999

[ERROR] level_008.json
  objectives[0].requiredCount
  Required count exceeds available target instances

=======================================
Result: FAILED
Errors: 3
Warnings: 0
```

# 十一、关卡可完成性检查

这是本项目非常重要的一部分。

仅仅保证 JSON 格式正确是不够的。

必须确保玩家能够通过正常操作完成关卡。

## 11.1 目标数量检查

假设目标是：

```
{
  "itemId": "headphones",
  "requiredCount": 3
}
```

那么关卡内至少需要存在 3 个符合匹配规则的有效实例。

如果只有 2 个，直接报错。

## 11.2 遮挡关系检查

例如：

```
A 被 B 遮挡
B 被 C 遮挡
C 没有遮挡
```

这是合法关系。

玩家可以：

1. 点击 C。
2. C 被移除。
3. 点击 B。
4. B 被移除。
5. 点击 A。

如果：

```
A 被 B 遮挡
B 被 A 遮挡
```

则形成循环遮挡，必须报错。

## 11.3 关卡可完成性

后续需要建立模拟器，模拟玩家按照合法点击顺序完成目标。

至少需要检查：

- 正确目标能够被获取。
- 所有目标数量都能完成。
- 遮挡关系最终能够解除。
- 不会出现因为数据配置导致的死局。
- 归位格规则与错误物件配置不会造成必然失败。

第一版可以先实现基础静态检查，后续再升级为完整状态搜索或模拟测试。

# 十二、第一章数据建设范围

第一章暂定 10 个关卡。

| 关卡 | 名称           | 总物件数 | 层数 | 找寻格 | 主要教学内容         |
| ---- | -------------- | -------- | ---- | ------ | -------------------- |
| 001  | 床头柜         | 12       | 1    | 2×3件  | 只点击正确物件       |
| 002  | 快递堆成山     | 15       | 1    | 2×4件  | 连续归位             |
| 003  | 奶茶杯的归宿   | 16       | 2    | 2×3件  | 翻层                 |
| 004  | 抽屉里的耳机   | 18       | 2    | 2×4件  | 首次捡错             |
| 005  | 桌面大扫除     | 18       | 2    | 2×4件  | 归位格接近满         |
| 006  | 外卖盒之灾     | 20       | 2    | 2×5件  | 首次提示闪烁         |
| 007  | 衣柜里的旧T恤  | 20       | 3    | 3×3件  | 第三找寻格广告       |
| 008  | 手机壳博物馆   | 22       | 3    | 3×3件  | 归位格满             |
| 009  | 数据线打结了   | 22       | 3    | 3×4件  | 第五、第六找寻格广告 |
| 010  | 沙发缝里的硬币 | 24       | 3    | 3×4件  | 综合验收、预期失败点 |

注意：

1. 上表用于确定关卡建设范围。
2. 目标物件的具体数量必须回到原始策划案和物件规划表核对。
3. 当前 Schema 示例不代表第一章最终关卡数据。
4. 第一版广告只做模拟，不接真实广告 SDK。
5. 第 10 关作为完整玩法验收关。

# 十三、当前需要确认的关键问题

在正式冻结 Schema 前，需要解决以下问题。

## 13.1 目标计数的含义

当前已经确认目标计数按品类计数，但 `Objective` 目前使用 `itemId`。

这两者需要明确。

例如：

假设物件库中有：

```
[
  {
    "id": "headphones",
    "category": "electronics"
  },
  {
    "id": "phone",
    "category": "electronics"
  }
]
```

如果目标是耳机，那么应该只匹配耳机。

如果目标是电子产品，那么耳机和手机都可能匹配。

两种规则完全不同。

**当前暂时保留 itemId 方案，不允许 Claude Code 擅自改成 category 匹配。**

正式冻结前需要确认：

- 是按照具体物件 ID 计数？
- 还是按照物件库的 category 字段计数？
- 还是按照目标图标所代表的具体物件类型计数？

## 13.2 找寻格数量和显示规则

需要明确：

- 一个目标类型是否占用一个找寻格？
- 目标数量是否以数字显示？
- baseCount 表示初始可见目标格数量，还是目标类型数量？
- maxCount 表示找寻格最多可扩展到多少格？

目前 Schema 中的 `baseCount` 和 `maxCount` 暂时保留，不能直接视为最终 UI 规则。

## 13.3 归位格救场规则

已经确认归位格满后：

游戏暂停，玩家可以选择救场或重开。

但救场的具体行为、资源成本、是否观看广告，尚未最终确定。

因此第一版只要求实现暂停和选择入口，不允许擅自确定救场成本。

## 13.4 设计分辨率

当前 Level 和 Scene 都有 designResolution。

需要决定：

- 保留两份配置，并要求两者一致。
- 或者只在 Scene 配置一次，Level 自动继承。

第一版可以先保留，并通过校验器检查一致性，后续再决定是否简化。

# 十四、Claude Code 实施要求

下面的要求可以直接作为后续开发任务的约束。

## 14.1 实施范围

第一阶段只完成数据基础设施：

1. 创建四份 JSON Schema。
2. 创建四类 TypeScript 类型定义。
3. 创建 JSON 配置加载器。
4. 创建 Ajv Schema 校验器。
5. 创建跨文件引用校验器。
6. 创建基础关卡业务校验器。
7. 创建遮挡关系检查器。
8. 创建第一版关卡可完成性检查器。
9. 创建配置校验命令。
10. 准备合法和非法测试配置。

## 14.2 不允许做的事情

- 不允许擅自修改已经确认的玩法规则。
- 不允许为了减少代码而省略业务校验。
- 不允许将正确物件放入归位格。
- 不允许将错误物件直接清除。
- 不允许擅自将 itemId 匹配改成 category 匹配。
- 不允许将 blocking 的语义反过来。
- 不允许接入真实广告 SDK。
- 不允许为了 Schema 设计而提前开发完整关卡编辑器。
- 不允许把示例数据当作第一章最终数据。
- 不允许未经确认修改现有游戏核心玩法代码。

## 14.3 测试要求

至少准备以下测试：

| 测试编号    | 测试内容            | 预期结果          |
| ----------- | ------------------- | ----------------- |
| SCHEMA-001  | 合法物件配置        | 通过              |
| SCHEMA-002  | 缺少必填字段        | 失败              |
| SCHEMA-003  | 物件尺寸为负数      | 失败              |
| SCHEMA-004  | 默认变体不存在      | 业务校验失败      |
| LEVEL-001   | 合法关卡配置        | 通过              |
| LEVEL-002   | 重复实例 ID         | 失败              |
| LEVEL-003   | 物件 ID 不存在      | 失败              |
| LEVEL-004   | 变体 ID 不存在      | 失败              |
| LEVEL-005   | 目标数量不足        | 失败              |
| LEVEL-006   | blocking 引用不存在 | 失败              |
| LEVEL-007   | 循环遮挡            | 失败              |
| LEVEL-008   | zone 不存在         | 失败              |
| LEVEL-009   | 物件坐标超出画布    | 失败或按规则警告  |
| CHAPTER-001 | 合法章节配置        | 通过              |
| CHAPTER-002 | 关卡 ID 不存在      | 失败              |
| CHAPTER-003 | chapterId 不一致    | 失败              |
| SCENE-001   | 合法场景配置        | 通过              |
| SCENE-002   | 重复 zone ID        | 失败              |
| SCENE-003   | 背景资源不存在      | 失败              |
| PICKUP-001  | 正确物件拾取        | 目标进度 +1       |
| PICKUP-002  | 正确物件拾取        | 归位格不增加占用  |
| PICKUP-003  | 错误物件拾取        | 归位格增加 1 占用 |
| PICKUP-004  | 同一物件重复点击    | 不重复结算        |
| PICKUP-005  | 被遮挡物件点击      | 不允许点击        |

# 十五、推荐实施顺序

不要一次性开发所有内容。

建议按下面顺序实施：

**阶段一：Schema 基础**

- 创建四份 Schema。
- 确保 Schema 本身能够正常解析。
- 编写合法和非法 JSON 测试。

**阶段二：TypeScript 类型**

- 创建四类配置类型。
- 确保类型与 Schema 对应。
- 建立统一配置索引。

**阶段三：配置加载**

- 加载物件配置。
- 加载场景配置。
- 加载章节配置。
- 加载关卡配置。

**阶段四：基础校验**

- JSON 格式校验。
- 唯一 ID 校验。
- 跨文件引用校验。
- 图片资源校验。

**阶段五：关卡业务校验**

- 目标数量校验。
- 格子配置校验。
- 坐标边界校验。
- 遮挡关系校验。
- 基础可完成性检查。

**阶段六：第一关真实数据验证**

使用第一关真实数据完成：

1. 加载物件。
2. 加载场景。
3. 加载关卡。
4. 渲染物件。
5. 点击正确物件。
6. 点击错误物件。
7. 验证遮挡。
8. 验证归位格。
9. 验证通关条件。

第一关完整跑通之后，再逐步录入第二至第十关。

# 十六、最终验收标准

这套数据系统完成后，必须达到以下标准：

- 

  四份 JSON Schema 可以正常使用。

- 

  四类 TypeScript 类型完整。

- 

  JSON 配置可以正常加载。

- 

  所有配置可以自动校验。

- 

  可以发现重复 ID。

- 

  可以发现错误引用。

- 

  可以发现缺失美术资源。

- 

  可以发现目标数量不足。

- 

  可以发现循环遮挡。

- 

  可以发现不存在的场景区域。

- 

  可以检查关卡可完成性。

- 

  第一关能够通过真实 JSON 配置运行。

- 

  正确物件不会进入归位格。

- 

  错误物件会占用归位格。

- 

  同一物件不会被重复结算。

- 

  修改普通关卡配置不需要修改核心玩法代码。

# 十七、设计结论

本项目采用：

**全局物件库 + 场景配置 + 章节配置 + 独立关卡 JSON + 自动校验系统。**

核心原则是：

1. 物件基础信息只维护一份。
2. 场景负责定义背景和区域。
3. 章节负责组织关卡。
4. 关卡负责定义物件实例、位置、遮挡和玩法参数。
5. TypeScript 负责执行玩法。
6. JSON 负责提供关卡数据。
7. Schema 负责检查格式。
8. 业务校验器负责检查规则。
9. 可完成性检查负责确保关卡能够通关。

第一章 10 关不仅是内容制作，更是对整套关卡生产体系的验证。

**最终目标：普通关卡可以通过 JSON 配置持续生产，而不需要每次都修改游戏核心代码。**