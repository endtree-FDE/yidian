"""重建扩展内置的 ZCOOL XiaoWei 子集字体。

为什么要它：
  一点的大字（宠物卡片那句话）用 ZCOOL XiaoWei。这套字里「回」被画成实心方块，
  放进最显眼的一行会像渲染坏了。所以文案避开它，同时字体子集必须覆盖所有会被
  大字渲染的字符——漏一个，那个字就会掉到系统字体，整句话变成两种字体。

流程：
  1) 准备原始字体（ZCOOLXiaoWei-Regular.ttf，OFL 授权）：
       https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf
     下载到任意位置，用环境变量 YIDIAN_FONT_SRC 指给它。
  2) python tools/build-font-subset.py
     自动收集界面文案用到的字符 → 子集化 → 与原字体逐字栅格化比对 → 写回扩展包。

用法：
  set YIDIAN_FONT_SRC=C:\\path\\to\\ZCOOLXiaoWei-Regular.ttf
  python tools/build-font-subset.py
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
FONTS_DIR = os.path.join(ROOT, 'extension', 'fonts')
TARGET = os.path.join(FONTS_DIR, 'ZCOOLXiaoWei-Regular.ttf')

# 会用大字渲染的界面文案来源
UI_SOURCES = [
    os.path.join(ROOT, 'extension', 'pet.js'),
    os.path.join(ROOT, 'packages', 'yidian-desktop', 'renderer', 'card.js'),
    os.path.join(ROOT, 'extension', 'shared.js'),
]

# 这些标点本来就是小圆点/方点，不算「方块字」
PUNCTUATION = '，。！？、；：,.!?'


def strip_comment_lines(text):
    """整行注释不参与字体要求。

    注释不会渲染，却被「扫全文取字」算进去 —— 改一句注释就要重建子集，纯噪音。
    只跳过「整行都是注释」的行；行尾注释照旧计入（宁可严，不可漏）。
    """
    kept = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            kept.append(line)
            continue
        if stripped.startswith('//'):
            continue
        if stripped.startswith('/*') and stripped.endswith('*/'):
            continue
        if stripped.startswith('*'):
            continue
        kept.append(line)
    return '\n'.join(kept)


def collect_chars():
    """收集界面文案里出现的全部字符（子集要覆盖它们，避免大字掉到系统字体）。"""
    chars = set()
    for path in UI_SOURCES:
        if not os.path.exists(path):
            print(f'  跳过（不存在）：{path}')
            continue
        with open(path, encoding='utf-8') as handle:
            text = strip_comment_lines(handle.read())
        for ch in text:
            code = ord(ch)
            if code > 0x2000 and not (0xE000 <= code <= 0xF8FF):
                chars.add(code)
    for ch in '0123456789 .,:;!?()%/-':
        chars.add(ord(ch))
    return sorted(chars)


def rasterize(path, chars, size=64):
    """返回 {字符: 墨迹覆盖率}；没有 Pillow 就返回 None（跳过自检）。"""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    font = ImageFont.truetype(path, size)
    result = {}
    for cp in chars:
        ch = chr(cp)
        img = Image.new('L', (size * 2, size * 2), 0)
        ImageDraw.Draw(img).text((size // 2, size // 2), ch, font=font, fill=255)
        bbox = img.getbbox()
        if not bbox:
            result[ch] = 0.0
            continue
        crop = img.crop(bbox)
        pixels = list(crop.getdata())
        result[ch] = sum(1 for p in pixels if p > 40) / len(pixels)
    return result


def main():
    source = os.environ.get('YIDIAN_FONT_SRC') or os.path.join(FONTS_DIR, '_orig.ttf')
    if not os.path.exists(source):
        print(f'缺少原始字体：{source}')
        print('请下载 ZCOOLXiaoWei-Regular.ttf 并用 YIDIAN_FONT_SRC 指给它')
        return 1

    chars = collect_chars()
    print(f'界面文案用到的字符：{len(chars)} 个')

    font = TTFont(source)
    options = subset.Options()
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = ['*']
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=chars)
    subsetter.subset(font)

    temp = TARGET + '.new'
    font.save(temp)

    # 自检：与原字体逐字比对墨迹覆盖率。
    # 只拦「大差异」（>0.35）：去掉 hinting 会让小字号的点与圈略有形变，视觉上无差别。
    # 「被填成实心块」是上游字体自己的字形特点（回/一就是这样），靠下面的方块字清单提醒避开。
    source_ratios = rasterize(source, chars)
    new_ratios = rasterize(temp, chars)
    problems = []
    blocky = []
    if source_ratios and new_ratios:
        for ch, ratio in new_ratios.items():
            origin = source_ratios.get(ch, 0.0)
            if abs(ratio - origin) > 0.35:
                problems.append((ch, round(ratio, 3), round(origin, 3)))
            if origin >= 0.85 and ch not in PUNCTUATION:
                blocky.append(ch)
    if problems:
        print('字形与原字体差异过大：', problems)
        os.remove(temp)
        return 1

    os.replace(temp, TARGET)
    print(f'已写入 {TARGET}（{os.path.getsize(TARGET)} 字节）')
    print(f'覆盖字符：{len(TTFont(TARGET).getBestCmap())} 个')
    if blocky:
        print(f'提醒：这些字在原字体里就是实心方块，别放进大字 —— {"".join(blocky)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
