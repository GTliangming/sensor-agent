"""出厂数据：业务线“视频号”、账号类型“女性向情感治愈类”的生成配置和提示词模板。

这些只是“第一次启动时写进数据库的初始值”，运行时一律从数据库读取，不读这个文件：
- 生成配置（seed、视频方向、时长/图片上限、AutoDL 工作流 ID 与请求字段名）在页面「账号设置」里改；
- 提示词模板在页面「提示词模板」里改（保存为新版本）。

幂等：已存在的记录不会被覆盖，后台改过的内容不会在重启后被还原。
升级时只补缺：账号类型缺哪些配置项就补哪些，缺哪种模板就补哪种。
新增账号类型：在页面「账号设置」里“复制当前账号类型”，或调用 POST /accounts（copy_from）。
"""
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Account, BusinessLine, PromptTemplate
from app.pipeline.default_templates import STARTER_BODIES

logger = logging.getLogger(__name__)

WECHAT_CHANNELS = "wechat_channels"
DEFAULT_SEED = 683072603085674


def _resolution(label: str, ratio_name: str, ratio: str, megapixels: float) -> dict:
    # values 是平台工作流里对应的节点参数，原样保存备查
    return {"label": label, "aspect_ratio": ratio, "megapixels": megapixels,
            "values": {"29.inputs.aspect_ratio": ratio_name, "29.inputs.megapixels": megapixels, "54.inputs.value": 1}}


CONFIG_VERSION = 2  # 出厂配置版本：升级时据此补上新版本才有的出厂值（只补一次，之后改动都以数据库为准）


def default_generation_config() -> dict:
    return {
        "config_version": CONFIG_VERSION,
        "workflow_id": get_settings().autodl_workflow_id,  # 只在首次写入时取 .env 里已有的值
        "seed": DEFAULT_SEED,
        "min_duration": 1, "max_duration": 15, "default_duration": 15,
        # H3 工作流：ref_image_0 必填（文档），所以至少要 1 张参考图；最多按需求限制为 8 张（文档支持到 ref_image_8）
        "max_images": 8, "max_audios": 3, "audio_enabled": False, "requires_image": True,
        "resolutions": [
            _resolution("480p横", "16:9 (Widescreen)", "16:9", 0.4),
            _resolution("480p竖", "9:16 (Portrait Widescreen)", "9:16", 0.4),
            _resolution("768p横", "16:9 (Widescreen)", "16:9", 0.98),
            _resolution("768p竖", "9:16 (Portrait Widescreen)", "9:16", 0.98),
            _resolution("480p(1:1)", "1:1 (Square)", "1:1", 0.23),
            _resolution("768p(1:1)", "1:1 (Square)", "1:1", 0.56),
        ],
        "default_resolution": "480p竖",
        # AutoDL 请求体字段名（官方文档）。参考图/音频是编号字段：前缀 + 0、1、2……，值是文件 URL。
        # 文档里没有负向提示词和台词参数：负向和台词都没有独立参数，分别通过「负向写法」「台词写法」模板拼进 prompt。
        "fields": {"prompt": "prompt", "duration": "duration", "resolution": "resolution", "seed": "seed",
                   "negative_prompt": "", "dialogue": "", "images": "ref_image_", "audios": "ref_audio_",
                   "image_mode": "url"},
        # 来自原提示词方案的视频参数，当前 H3 工作流不使用，先保存备查
        "video_config": {"width": 1280, "height": 720, "fps": 30, "motion_bucket_id": 40, "augmentation_level": 0.1},
    }


FEMALE_HEALING_CONTENT = """你是一个专为“温暖治愈+清醒恋爱观”账号服务的自动化短视频编导。你负责从零策划主题，并生成带字幕和提示词的业务JSON数据。
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
3. 情绪必须从 压抑/内耗 ➡️ 清醒/释怀 转变。"""

# 以下三份是为了让流程完整而补的，不是你提供的原文，请按需修改
FEMALE_HEALING_CONTENT_USER = """请开始生成，只输出 JSON。

【本次主题】{{topic}}
（主题为空：按系统提示的要求，自己随机选一个微主题。主题不为空：以它为准，不再随机选择。）
【视频时长】{{duration_seconds}} 秒。系统提示里的示例按 15 秒设计，请按时长等比例调整台词字数（每秒约 3.5 个字）和字幕时间轴，镜头数量保持 3 个。

{{revision_notes}}"""

FEMALE_HEALING_TOPIC = """你是短视频选题策划。只输出一个 JSON 对象，不要输出其他文字。格式：{"topic": "微主题"}

账号：{{account_name}}
人设：{{persona}}
请随机想一个“女性清醒成长”微主题（中文，12 字以内），方向参考：停止内耗、拒绝讨好、双向奔赴、释怀、自我价值。
最近用过的主题，不要重复：{{recent_topics}}"""

# 原模板写死了 16:9；视频方向现在由用户在表单里选择，所以画幅改成变量
FEMALE_HEALING_BASE = (
    "(masterpiece, best quality:1.2), strict {{aspect_ratio}} aspect ratio, 2D anime illustration style, "
    "cinematic lighting, no text, no watermark, "
)
FEMALE_HEALING_CHARACTER = (
    "A cute chibi girl with round glasses, fluffy cloud-like white hair, wearing a '醒' hair clip and a white shirt, "
)
FEMALE_HEALING_NEGATIVE = (
    "(worst quality, low quality:1.4), text, watermark, subtitles, chinese characters, signature, distorted face, "
    "extra limbs, bad anatomy, bad proportions, deformed hands, fast motion, shaky camera, multiple girls, "
    "real photo, 3d render."
)

FEMALE_HEALING_TEMPLATES = {
    "content": ("内容生成（系统提示）", FEMALE_HEALING_CONTENT),
    "content_user": ("内容生成（用户消息）", FEMALE_HEALING_CONTENT_USER),
    "topic_suggest": ("AI 想主题", FEMALE_HEALING_TOPIC),
    "video_base": ("视频提示词前缀", FEMALE_HEALING_BASE),
    "video_character": ("角色设定", FEMALE_HEALING_CHARACTER),
    "video_shot": ("镜头写法", STARTER_BODIES["video_shot"]),
    "video_dialogue": ("台词写法", STARTER_BODIES["video_dialogue"]),
    "video_negative": ("负向提示词", FEMALE_HEALING_NEGATIVE),
    "video_negative_line": ("负向写法", STARTER_BODIES["video_negative_line"]),
}


def ensure_defaults(db: Session) -> None:
    if not db.get(BusinessLine, WECHAT_CHANNELS):
        db.add(BusinessLine(key=WECHAT_CHANNELS, name="视频号", sort_order=1))

    account = db.scalar(select(Account).where(Account.platform == WECHAT_CHANNELS, Account.slug == "female_healing"))
    config = default_generation_config()
    if not account:
        account = Account(
            id=str(uuid.uuid4()), slug="female_healing", name="女性向情感治愈类账号", platform=WECHAT_CHANNELS,
            persona="温暖治愈加清醒恋爱观的女性向情感账号，主角是戴圆框眼镜、云朵白发的 Q 版女孩，语气真诚、不说教",
            style_guide="2D 动漫插画风格，温暖的电影光；情绪从压抑内耗转向清醒释怀；不出现男女对立、抓小三、查手机、绿茶套路",
            workflow_key="h3_reference_video", params=config,
        )
        db.add(account)
        db.flush()
    else:
        existing = dict(account.params or {})
        merged = {**config, **existing}  # 只补缺失的配置项，已有的（包括后台改过的）保持不变
        if existing.get("config_version", 1) < CONFIG_VERSION:
            # 版本 2：按 AutoDL 官方文档修正之前猜测的请求字段（参考图改为 ref_image_N 的 URL，参考图必填）。
            # 这几项是上一版出厂的猜测值，不是用户编辑的结果，所以只在升级这一次覆盖。
            for key in ("requires_image", "fields", "config_version"):
                merged[key] = config[key]
        if merged != account.params:
            account.params = merged
        if not merged.get("workflow_id") and config["workflow_id"]:
            # .env 里已经填过工作流 ID、而数据库里还是空的：补上（只补空值，不覆盖已有的）
            account.params = {**merged, "workflow_id": config["workflow_id"]}

    for kind, (name, body) in FEMALE_HEALING_TEMPLATES.items():
        exists = db.scalar(select(PromptTemplate.id).where(
            PromptTemplate.account_id == account.id, PromptTemplate.kind == kind).limit(1))
        if not exists:
            db.add(PromptTemplate(id=str(uuid.uuid4()), group_id=str(uuid.uuid4()), version=1, kind=kind, name=name,
                                  account_id=account.id, body=body))
    db.commit()


def main() -> None:
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        ensure_defaults(db)
    logger.info("seed done")


if __name__ == "__main__":
    main()
