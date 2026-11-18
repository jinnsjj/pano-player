import { annotationLimits } from './annotation-data.js';

export const annotationExample = `{
  "fps": 25,
  "annotations": [
    {
      "start": 0, "end": 0.2,
      "label": "Region A",
      "source": "method-a",
      "bbox": [0.1, 0.2, 0.4, 0.8],
      "active": false, "confidence": 0.88
    },
    {
      "start": 0, "end": 0.1,
      "point": [0.3, 0.4]
    },
    { "start": 0, "end": 0.3, "label": "Scene note" },
    { "timestamp": 0.1, "point": [0.4, 0.5] },
    { "frame": 5, "label": "Face", "bbox": [0.2, 0.2, 0.4, 0.5] }
  ]
}`;

export const annotationFormatHelp = `<details id="annotation-format">
  <summary title="Annotation JSON format" aria-label="Annotation JSON format"><i data-lucide="circle-help" aria-hidden="true"></i><span>JSON format</span></summary>
  <div class="annotation-format-content" lang="zh-CN">
    <pre tabindex="0" role="region" aria-label="Annotation JSON example"><code>${annotationExample}</code></pre>
    <dl>
      <dt>JSON v1</dt><dd>根对象包含 <code>annotations</code> 数组。<code>version</code> 可省略，默认按 v1 解析；显式提供时只接受 <code>version: 1</code>。每条标注选择一种时间格式：<code>start/end</code>、<code>timestamp</code> 或 <code>frame</code>，不能混用；文本、来源和位置可选。</dd>
      <dt>秒区间</dt><dd><code>start</code>、<code>end</code> 为视频时间，单位为秒，要求 <code>0 &lt;= start &lt; end</code>。在 <code>[start, end)</code> 内显示，结束时刻不包含；不插值、不跨缺失采样延长。</dd>
      <dt>时间戳</dt><dd><code>timestamp</code> 为非负秒数，必须明确 <code>fps</code>，显示于 <code>[timestamp, timestamp + 1 / fps)</code>，即一个标注采样周期；不猜测毫秒单位。</dd>
      <dt>帧号与 FPS</dt><dd><code>frame</code> 为从 0 开始的非负安全整数，必须明确 <code>fps</code>，显示于 <code>[frame / fps, (frame + 1) / fps)</code>。<code>fps</code> 是正数，可在根对象统一声明，也可在单条标注中覆盖，支持小数。它属于标注本身，例如人脸 25 FPS、SELD 10 FPS；不会自动采用视频 FPS。变帧率视频的实际帧应使用真实时间戳。</dd>
      <dt>区域或点（可选）</dt><dd>区域用 <code>bbox: [left, top, right, bottom]</code>，左小于右、上小于下；点用 <code>point: [x, y]</code>，有值时最多提供一种。</dd>
      <dt>时间片段文本</dt><dd>省略 <code>bbox</code>、<code>point</code> 或将两者设为 <code>null</code> 时，非空 <code>label</code> 显示于视频旁，窄屏时显示于视频下方，如示例第三条。时间范围、并发显示和来源筛选与区域、点标注相同，只是显示位置不同。没有位置且没有文本时不显示，但仍计入总数。</dd>
      <dt>坐标</dt><dd>数值归一化到 <code>[0, 1]</code>，原点在左上，x 向右、y 向下。以旋转、单眼裁剪和投影前的完整解码帧为准，不是像素或当前视口坐标。</dd>
      <dt>文本与来源（可选）</dt><dd><code>label</code> 是标注文本，可描述区域、点或整个时间片段；<code>source</code> 是标注来源或方法名称，用于筛选和配色。缺少哪项就不显示对应文字，不生成占位文本。省略、<code>null</code> 或空白字符串均视为未提供；字符串最长 2,000 字符。</dd>
      <dt>无效条目</dt><dd>非法时间、位置、文本或单条 <code>fps</code> 只跳过该条，其余合法条目照常加载；提示加载和跳过数量，以及前 ${annotationLimits.issues} 个错误的原始条目编号（从 1 开始，非文件行号）。不自动修复，也不修改源文件。若全部条目无效，或 JSON、根对象、根 <code>fps</code> 不合法，原标注保持不变。</dd>
      <dt>自定义字段</dt><dd>每条标注的额外字段（如 <code>active</code>、<code>confidence</code>）可在 <code>Label fields</code> 中逐项勾选，默认不显示。已选字段以 <code>字段名: JSON值</code> 附加到标签；缺少的字段不显示，<code>false</code>、<code>0</code>、<code>null</code> 和空字符串仍保留。只影响文字，不改变标注是否显示或源文件。</dd>
      <dt>限制</dt><dd>文件不超过 ${annotationLimits.bytes / (1024 * 1024)} MiB，最多 ${annotationLimits.count.toLocaleString('en-US')} 条标注。</dd>
    </dl>
  </div>
</details>`;
