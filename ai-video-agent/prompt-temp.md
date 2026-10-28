## 传给AutoDL 接口的prompt模板

通用模板
```json
# 1. 全局通用正向前缀 (拼在每个镜头前面)
BASE_PROMPT = "(masterpiece, best quality:1.2), strict 16:9 widescreen, 2D anime illustration style, cinematic lighting, no text, no watermark, "

# 2. 固定角色设定 (IP-Adapter 锁定的角色特征)
CHARACTER_PROMPT = "A cute chibi girl with round glasses, fluffy cloud-like white hair, wearing a '醒' hair clip and a white shirt, "

# 3. 全局通用负向提示词
NEGATIVE_PROMPT = "(worst quality, low quality:1.4), text, watermark, subtitles, chinese characters, signature, distorted face, extra limbs, bad anatomy, bad proportions, deformed hands, fast motion, shaky camera, multiple girls, real photo, 3d render."

# 4. 全局固定参数
VIDEO_CONFIG = {
    "width": 1280,
    "height": 720,
    "fps": 30,
    "motion_bucket_id": 40,
    "augmentation_level": 0.1
}
```

 动态业务数据
```json
{
  "tts_text": "身边人都在催你交卷，仿佛不结婚就是错。你也试过妥协，去见条件合适的人。但后来你想通了，婚姻不是标准答案，你才是。",
  "subtitles": [
    {"start": "00:00:00,000", "end": "00:00:05,000", "text": "身边人都在催你交卷，仿佛不结婚就是错"},
    {"start": "00:00:05,000", "end": "00:00:10,000", "text": "你也试过妥协，去见条件合适的人"},
    {"start": "00:00:10,000", "end": "00:00:15,000", "text": "但后来你想通了，婚姻不是标准答案，你才是"}
  ],
  "scenes": [
    {
      "scene_id": 1,
      "scene_desc": "sitting on a sofa in a warm-toned living room. blurred figures of elders holding paper documents and pointing.",
      "action_desc": "head down, hands clenched, sad expression.",
      "camera_desc": "Slow camera push-in on the girl's face, oppressive atmosphere."
    },
    {
      "scene_id": 2,
      "scene_desc": "at a cafe table at night. a blurred shoulder of a young man in a suit holding a clipboard, coffee cups on the table.",
      "action_desc": "resting chin on hand, looking blankly at a coffee cup, numb expression, steam rising.",
      "camera_desc": "Slow camera pan to the girl, melancholic mood."
    },
    {
      "scene_id": 3,
      "scene_desc": "standing on a quiet street at night. A warm glowing street lamp, a bright crescent moon and twinkling stars in the dark blue sky.",
      "action_desc": "looking up at the sky, peaceful and relieved smile, gentle breeze blowing her hair.",
      "camera_desc": "Slow camera pull back to reveal the night sky, healing and uplifting vibe."
    }
  ]
}
```


后端拼装逻辑
```python
def build_comfyui_payload(payload_data):
    # 1. 提取文案和字幕
    tts_text = payload_data["tts_text"]
    srt_data = payload_data["subtitles"]
    
    # 2. 循环拼装每个镜头的正向提示词
    generated_prompts = []
    for scene in payload_data["scenes"]:
        # 核心拼装公式：基础前缀 + 固定角色 + 场景变量 + 动作变量 + 运镜变量
        full_positive_prompt = (
            BASE_PROMPT + 
            CHARACTER_PROMPT + 
            scene["scene_desc"] + " " + 
            scene["action_desc"] + " " + 
            scene["camera_desc"]
        )
        
        generated_prompts.append({
            "scene_id": scene["scene_id"],
            "positive_prompt": full_positive_prompt,
            "negative_prompt": NEGATIVE_PROMPT,
            "config": VIDEO_CONFIG
        })
        
    # 3. 组装最终的 API Payload
    api_request = {
        "tts_input": tts_text,
        "subtitle_input": srt_data,
        "video_generation_tasks": generated_prompts
    }
    
    return api_request

# 测试输出（看看拼装出来的英文提示词是否完美）
import json
# api_payload = build_comfyui_payload(your_json_data)
# print(json.dumps(api_payload, indent=2, ensure_ascii=False))
```


其中 动态业务数据 是调用 LLM模型生成的， 模板需要根据业务数据的变化而变化， 我也会给一个LLM模型的模板


LLM 基础模板

```
你是一个专为“温暖治愈+清醒恋爱观”账号服务的自动化短视频编导。你负责从零策划主题，并生成带字幕和提示词的业务JSON数据。
主角固定为：戴圆框眼镜、云朵白发的Q版女孩（无需你描述外貌）。

【每次调用，你必须随机选择一个“女性清醒成长”微主题，如：停止内耗、拒绝讨好、双向奔赴、释怀、自我价值。】

严格按照“起、承、转”生成15秒的短视频数据，直接输出纯JSON（严禁包含```json标记）：
{
  "theme": "自动生成的微主题名称（中文）",
  "tts_text": "中文台词，限45-55字，符合15秒语速，温暖清醒。",
  "subtitles": [
    {"start": "00:00:00,000", "end": "00:00:05,000", "text": "第一句台词"},
    {"start": "00:00:05,000", "end": "00:00:10,000", "text": "第二句台词"},
    {"start": "00:00:10,000", "end": "00:00:15,000", "text": "第三句台词"}
  ],
  "scenes": [
    {
      "scene_id": 1,
      "scene_desc": "英文短语，如: in a dim bedroom, looking at a phone screen",
      "action_desc": "英文短语，如: sitting on bed, sad expression",
      "camera_desc": "英文短语，如: Slow camera push-in, oppressive atmosphere"
    },
    {
      "scene_id": 2,
      "scene_desc": "英文短语，如: at a cafe table, blurred figures in background",
      "action_desc": "英文短语，如: resting chin on hand, numb expression",
      "camera_desc": "英文短语，如: Slow camera pan to the girl"
    },
    {
      "scene_id": 3,
      "scene_desc": "英文短语，如: under a street lamp at night, bright moon and stars",
      "action_desc": "英文短语，如: looking up, peaceful and relieved smile",
      "camera_desc": "英文短语，如: Slow camera pull back, healing vibe"
    }
  ]
}

【必须遵守的底线】
1. scenes 里的描述必须是纯英文短语。
2. 绝不出现任何“男女对立、抓小三、查手机、绿茶套路”等负面内容。
3. 情绪必须从 压抑/内耗 ➡️ 清醒/释怀 转变。
```