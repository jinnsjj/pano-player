# 标注时间轴与研究格式兼容调研

核查日期：2026-11-12。依据官方数据说明与实现源码；`main` 链接可能随上游更新。
这是兼容设计的研究记录，不表示播放器已经支持这些外部格式，也不是研究影响力排名。

## 已核实：人脸与视听说话人

### AV-MossFormer2 / ClearerVoice-Studio

- `faces.pckl`、`tracks.pckl` 是推理预处理生成的 Python pickle 中间结果，不应称为统一的人工标注标准。流程先转为 **25 fps**，再检测和跟踪；帧号来自 `enumerate`，从 **0** 开始。若流程截取了片段，帧号属于片段时间轴。[处理源码](https://github.com/modelscope/ClearerVoice-Studio/blob/main/clearvoice/clearvoice/utils/video_process.py#L58-L98)
- `faces.pckl` 是逐帧列表，每帧可有多个 `{frame, bbox, conf}`；`tracks.pckl` 的每项包含 `track: {frame, bbox}` 和 `proc_track: {x, y, s}`，后者是平滑后的框中心与半尺寸。框轨迹会在首尾检测之间插值，然后对中心和半尺寸做中值平滑；不能把全部轨迹点都当成原始检测。[检测、跟踪和裁剪源码](https://github.com/modelscope/ClearerVoice-Studio/blob/main/clearvoice/clearvoice/utils/video_process.py#L143-L243)
- 轨迹编号由列表顺序产生，未建立跨镜头人物身份。预处理帧率不能替换为原视频帧率。[轨迹使用源码](https://github.com/modelscope/ClearerVoice-Studio/blob/main/clearvoice/clearvoice/utils/video_process.py#L292-L304)
- `bbox` 为处理后完整帧的像素 `xyxy`；检测器将坐标乘以输入图像的宽、高，不是直接输出归一化坐标。[S3FD 坐标还原源码](https://github.com/modelscope/ClearerVoice-Studio/blob/main/clearvoice/clearvoice/models/av_mossformer2_tse/faceDetector/s3fd/__init__.py#L32-L61)

### AVA Active Speaker / TalkNet

- AVA Active Speaker 的一行是一帧中一张脸：`video_id, frame_timestamp, x1, y1, x2, y2, label, entity_id`。时间戳单位为**秒**，相对于视频开始；框是左上、右下归一化 `xyxy`，左上为 `(0,0)`；`entity_id` 连接相邻帧中的同一个人，同一时间可以有多张脸。[AVA 官方格式](https://sites.research.google/gr/ava/download/)
- TalkNet 的 AVA 数据预处理按 `frame_timestamp` 排序，并以 `timestamp * 1000` 定位视频、将归一化框乘以帧宽高后裁脸。这条训练数据路径是时间戳索引。[TalkNet 数据预处理](https://github.com/TaoRuijie/TalkNet-ASD/blob/main/utils/tools.py#L138-L183)
- TalkNet 的任意视频 demo 则先转 **25 fps**，生成与上述形式相近的检测、轨迹 pickle；因此“TalkNet 格式”需要区分 AVA 数据和 demo 中间结果，不是只有一种时间表达。[TalkNet demo](https://github.com/TaoRuijie/TalkNet-ASD/blob/main/demoTalkNet.py#L349-L443)
- TalkNet 评估器使用时间戳与 `entity_id` 联合匹配记录，并单独读取预测 `score`。身份、类别和置信度应作为不同字段保留。[评估代码](https://github.com/TaoRuijie/TalkNet-ASD/blob/main/utils/get_ava_active_speaker_performance.py#L69-L137)

### 辅助对照：MOTChallenge 跟踪交换格式

MOTChallenge 的跟踪器结果为 `frame, id, bb_left, bb_top, bb_width, bb_height, conf, x, y, z`，帧号、目标 ID 和框坐标采用 **1 起始**，二维任务忽略最后三列世界坐标。它不是人脸专属规范，但说明导入层需要处理不同索引起点和像素 `xywh`，不能假设所有逐帧研究输出都与 AV-MossFormer2 相同；也不应将该预测格式泛化为所有真值文件。[官方评估工具的 MOT 格式说明](https://github.com/JonathonLuiten/TrackEval/blob/master/docs/MOTChallenge-Official/Readme.md?plain=1)

## 已核实：SELD 与 STARSS

### DCASE 2023 / STARSS23：标签帧不是视频帧

官方视频为 **29.97 fps** 的 ERP；参考标签每 **100 ms** 一帧，即 **10 Hz**，帧号从 **0** 开始。CSV 行为 `frame, class, source_id, azimuth, elevation, distance`，角度用度，距离用厘米。将标签的 `frame=10` 除以视频的 29.97 会得到错误时间；应映射到 1 秒。[DCASE 2023 视频与参考标签](https://dcase.community/challenge2023/task-sound-event-localization-and-detection-evaluated-in-real-spatial-sound-scenes)

### DCASE 2024：参考标签和提交格式也有区别

参考标签保留上述六列，预测提交则是五列 `frame, class, azimuth, elevation, distance`。同一时间多声源重复使用同一个帧号，没有事件的帧不写行。参考 `source_id` 对演员按人关联，非演员声源采用 0，不能直接当成通用物体轨迹 ID。方位角正前方 0 度、左侧 +90 度，仰角向上 +90 度，距离为厘米。[DCASE 2024 参考标签与提交格式](https://dcase.community/challenge2024/task-audio-and-audiovisual-sound-event-localization-and-detection-with-source-distance-estimation)

官方 baseline 还在内部读入极坐标或笛卡尔坐标，方向转换为 `x=cos(az)*cos(el), y=sin(az)*cos(el), z=sin(el)`。CSV 交换格式、模型训练张量和方向向量不是同一个层次。[baseline 加载及坐标转换](https://github.com/partha2409/DCASE2024_seld_baseline/blob/main/cls_feature_class.py)

### DCASE 2025：同为六列，含义已经不同

立体声常规视频任务的参考行是 `frame, class, source_id, azimuth, distance, off_onscreen`，仍是 100 ms、0 起始帧，但没有 elevation；最后一列表示画外 0 / 画内 1。其方位角有前后折叠约定。导入器必须明确年份与任务，不能按列数猜格式，也不能给缺失的仰角补 0 后声称获得准确二维画面位置。[DCASE 2025 任务及标签格式](https://dcase.community/challenge2025/task-stereo-sound-event-localization-and-detection-in-regular-video-content)

### DCASE 2026：还有声学图，而不只是单点

参考声学图采用 JSON，包括 10 Hz、0 起始的 `metadata_frame_index`，以及实例、类别、距离和 `segmentation` 中的 `[x,y,intensity]`。这说明今后的兼容范围可能包含稀疏声学图。该页面的横向角度原点描述存在冲突，接入前应核对真实数据及生成器，不宜直接照网页猜投影。[DCASE 2026 声学图格式](https://dcase.community/challenge2026/task-semantic-acoustic-imaging-for-sound-event-localization-and-detection-from-spatial-audio-and-audiovisual-scenes)

另需区别模型预测槽位与身份：ADPIT 训练允许同类目标槽位排列互换，因此输出槽位号不应自动转换为稳定人物或声源身份。[Multi-ACCDOA / ADPIT 原论文，第 3 节](https://arxiv.org/pdf/2110.07124.pdf)

## 对 PanoPlayer 的设计建议

以下是依据上述差异提出的设计选择，不是外部研究的原有规范，也不是已实现功能。

1. **输入兼容，内部统一。** 保留旧 `start/end` 秒区间；新增时间戳采样和整数帧采样输入，导入后统一转换为内部半开秒区间。不把所有外部格式都塞进渲染器。
2. **显式声明标注时基。** 帧号绑定的是标注采样率，可以是 25 Hz 人脸轨迹、10 Hz SELD 标签，也可以是真正的视频帧。字段宜叫 `timebase` 或 `annotation_rate`，而不是含义不明的“视频 FPS”。同一文件混合多种采样率时，按输入流或轨迹声明时基，或合并前逐条转为秒；文件级时基只能是可覆盖的默认值。支持有理数采样率、0/1 起点及片段到当前媒体的时间偏移；时间戳明确秒或毫秒，不自动猜单位。变帧率原视频的帧索引或经过复杂编辑的数据应使用真实 PTS 或显式映射，不能仅凭平均 FPS。
3. **采样点必须有显示时长语义。** 一帧采样在声明时基下占一个 tick；时间戳记录需要明确持续时长、采样步长或结束时间。默认不跨缺失帧、事件间隙和轨迹边界延长显示，也不自动插值。AV-MossFormer2 已插值的轨迹与原始检测要能区分。
4. **时间、位置与身份分开。** 保留 `track_id/entity_id`、类别、方法来源和置信度；来源不是人物 ID，轨迹也不默认代表跨镜头身份。同一时间允许多个独立对象。不同方法的置信度不自动当成可比概率。
5. **声明坐标约定。** 支持归一化 `xyxy` 和像素框适配，像素框必须知道其对应图像宽高、裁剪及缩放关系；极坐标或 XYZ 方向需声明单位与轴向。仅在投影关系已知时转成画面点，不从无仰角的方位数据捏造精确二维位置。保留原坐标及距离便于核查。
6. **专用适配器与统一展示格式分层。** 优先接 AVA Active Speaker CSV、AV-MossFormer2/TalkNet 轨迹转换，以及明确版本的 DCASE CSV；复杂声学图留作后续能力。`frame` 或 `timestamp` 支持本身不等于能直接读取这些研究文件。
7. **不自动反序列化任意 pickle。** AV-MossFormer2 的中间结果优先通过受信任、用户主动运行的离线工具转换为 JSON；Python 官方明确警告不受信任的 pickle 可能执行任意代码。[Python pickle 安全说明](https://docs.python.org/3/library/pickle.html)

对于规则采样时基，基本映射为 `seconds = offset_seconds + (frame - index_base) * step_seconds`。这里的步长必须属于标注本身，不能默认从当前视频 FPS 读取。即使格式可转换，还需独立验证播放时的视觉对齐，尤其是快速运动的人脸。

## 调研时的实现边界

调研时的解析器只接受 `version: 1`、`annotations` 和每条必需的 `start/end` 秒区间，几何采用归一化 `bbox` 或 `point`；额外身份字段不会被保留。时间轴使用 `[start,end)` 且不插值。调研阶段仅新增本研究记录。

同日后续实现已增加 `timestamp` 和 `frame` 输入：`timestamp` 单位为秒，`frame` 从零开始，两者都必须提供标注 `fps`，每条显示一个 `1 / fps` 秒的采样周期；根对象可声明默认 FPS，单条可覆盖。导入后仍统一为秒区间。不包含原生 CSV/pickle 适配、额外身份字段或实际显示帧锁定。以 [`annotation-data.js`](../plugins/annotations/annotation-data.js) 与 [`ANNOTATIONS.md`](ANNOTATIONS.md) 为准。

现有插件状态以 `video.currentTime` 查询标注，不暴露实际呈现视频帧的 PTS；流播放器也按播放时钟调度绘帧。因此 `frame -> seconds` 只是时间格式兼容，尚不构成严格的逐显示帧同步保证。若要精确跟随每张人脸框，还需提供实际呈现帧时间并验证 seek、慢解码与高帧率下的对齐。见 [`media/player.js`](../media/player.js)、[`annotation-overlay.js`](../plugins/annotations/annotation-overlay.js) 与 [`src/stream-player.js`](../src/stream-player.js)。
