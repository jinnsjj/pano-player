import { annotationLimits } from './annotation-data.js';

export const annotationExample = `{
  "version": 1,
  "annotations": [
    {
      "start": 0, "end": 0.2,
      "label": "person",
      "source": "model-a",
      "bbox": [0.1, 0.2, 0.4, 0.8]
    },
    {
      "start": 0, "end": 0.1,
      "point": [0.3, 0.4]
    },
    { "start": 0, "end": 0.3 }
  ]
}`;

export const annotationFormatHelp = `<details id="annotation-format">
  <summary title="Annotation JSON format" aria-label="Annotation JSON format"><i data-lucide="circle-help" aria-hidden="true"></i><span>JSON format</span></summary>
  <div class="annotation-format-content" lang="zh-CN">
    <pre tabindex="0" role="region" aria-label="Annotation JSON example"><code>${annotationExample}</code></pre>
    <dl>
      <dt>JSON v1</dt><dd>根对象包含 <code>version: 1</code> 和 <code>annotations</code> 数组。每条标注只要求 <code>start</code>、<code>end</code>；名称、来源和位置可选。</dd>
      <dt>时间</dt><dd>视频时间，单位为秒，要求 <code>0 &lt;= start &lt; end</code>。在 <code>[start, end)</code> 内显示，结束时刻不包含；不插值。</dd>
      <dt>形状（可选）</dt><dd><code>bbox: [left, top, right, bottom]</code>，左小于右、上小于下；或 <code>point: [x, y]</code>，有值时最多提供一种。都省略或为 <code>null</code> 时，该条不绘制，但仍计入总数，如示例第三条。</dd>
      <dt>坐标</dt><dd>数值归一化到 <code>[0, 1]</code>，原点在左上，x 向右、y 向下。以旋转、单眼裁剪和投影前的完整解码帧为准，不是像素或当前视口坐标。</dd>
      <dt>名称与来源（可选）</dt><dd><code>label</code> 是对象或部位名称；<code>source</code> 是标注方法或来源，不是物理声源。缺少哪项就不显示对应文字，不生成占位名称。省略、<code>null</code> 或空白字符串均视为未提供；字符串最长 2,000 字符。</dd>
      <dt>限制</dt><dd>文件不超过 ${annotationLimits.bytes / (1024 * 1024)} MiB，最多 ${annotationLimits.count.toLocaleString('en-US')} 条标注。额外字段会被忽略。</dd>
    </dl>
  </div>
</details>`;
