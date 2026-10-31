/**
 * Timeline exports for the Autocut tab.
 *
 * The default Autocut output is a rendered MP4. When the user asks for a
 * timeline instead, the kept segments become edit points in an editor project:
 * Premiere Pro and Vegas Pro read FCP 7 XML, DaVinci Resolve reads FCPXML 1.10,
 * Final Cut Pro reads FCPXML 1.11, and Shotcut reads MLT. Every file references
 * the original media, so the editor can relink it if needed.
 *
 * Everything here is pure so the XML can be tested without FFmpeg.
 * @module features/autocut/timeline-export
 */

/* ------------------------------------------------------------------ frames */

// Common broadcast rates need an exact rational frame duration. The tolerance
// absorbs the two-decimal `fps` value printed by FFmpeg.
const NTSC_RATES = [
  { fps: 23.976, numerator: 1001, denominator: 24000 },
  { fps: 29.97, numerator: 1001, denominator: 30000 },
  { fps: 47.952, numerator: 1001, denominator: 48000 },
  { fps: 59.94, numerator: 1001, denominator: 60000 },
  { fps: 119.88, numerator: 1001, denominator: 120000 },
];

/** @param {number} fps */
function frameRate(fps) {
  const value = Number(fps);
  if (!Number.isFinite(value) || value <= 0) {
    return { fps: 30, numerator: 1, denominator: 30, ntsc: false };
  }

  const ntsc = NTSC_RATES.find((rate) => Math.abs(value - rate.fps) <= 0.03);
  if (ntsc) return { ...ntsc, ntsc: true };

  const rounded = Math.max(1, Math.round(value));
  return { fps: rounded, numerator: 1, denominator: rounded, ntsc: false };
}

/** @param {number} seconds @param {{ fps: number }} rate */
function toFrames(seconds, rate) {
  return Math.max(0, Math.round((Number(seconds) || 0) * rate.fps));
}

/**
 * FCPXML duration for a frame count: 41 frames at 59.94 is `4100/5993s`.
 * @param {number} frames
 * @param {{ numerator: number, denominator: number }} rate
 */
function frameTime(frames, rate) {
  if (frames === 0) return '0s';
  return `${frames * rate.numerator}/${rate.denominator}s`;
}

/** @param {number} fps */
function premiereRateXml(fps) {
  const rate = frameRate(fps);
  return `<rate><timebase>${Math.round(rate.fps)}</timebase><ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
}

/**
 * @param {Array<{ start: number, end: number }>} segments
 * @param {{ fps: number }} rate
 */
function frameSegments(segments, rate) {
  let cursor = 0;
  return segments.map((segment) => {
    const start = toFrames(segment.start, rate);
    const end = Math.max(start + 1, toFrames(segment.end, rate));
    const duration = end - start;
    const entry = { start, end, duration, cursor };
    cursor += duration;
    return entry;
  });
}

/* -------------------------------------------------------------------- XML */

/** @param {unknown} value */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** @param {string} name */
function baseName(name) {
  return String(name ?? 'video').replace(/\.[^.\\/]+$/, '') || 'video';
}

/**
 * Return a value an editor can resolve as a media location. Desktop paths stay
 * untouched for Premiere (it accepts native paths) and become file URLs for
 * FCPXML. Web builds only know the file name, so they emit a relative path.
 * @param {string} path
 */
function mediaUrl(path) {
  const raw = String(path ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return `file:///${raw.replace(/\\/g, '/')}`;
  return raw || './video.mp4';
}

/* --------------------------------------------------------------- Premiere */

/**
 * @param {object} options
 * @param {string} options.name source file name
 * @param {string} options.mediaPath path stored in `<pathurl>`
 * @param {number} options.duration source duration, in seconds
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {boolean} options.hasAudio
 * @param {Array<{ start: number, end: number }>} options.segments
 * @returns {string}
 */
export function buildPremiereXml({ name, mediaPath, duration, width, height, fps, hasAudio, segments }) {
  const rate = frameRate(fps);
  const clips = frameSegments(segments, rate);
  if (clips.length === 0) return '';

  const widthValue = Number(width) > 0 ? Math.round(width) : 1920;
  const heightValue = Number(height) > 0 ? Math.round(height) : 1080;
  const sourceFrames = Math.max(1, toFrames(duration, rate));
  const totalFrames = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const label = escapeXml(baseName(name));
  const path = escapeXml(String(mediaPath || `./${name || 'video.mp4'}`));
  const rateXml = premiereRateXml(rate.fps);

  const fileBlock = `<file id="file-1">
            <name>${label}</name>
            <pathurl>${path}</pathurl>
            <timecode>
              <string>00:00:00:00</string>
              <displayformat>NDF</displayformat>
              ${rateXml}
            </timecode>
            ${rateXml}
            <duration>${sourceFrames}</duration>
            <media>
              <video>
                <samplecharacteristics>
                  ${rateXml}
                  <width>${widthValue}</width>
                  <height>${heightValue}</height>
                  <pixelaspectratio>square</pixelaspectratio>
                </samplecharacteristics>
              </video>${
                hasAudio
                  ? `
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>`
                  : ''
              }
            </media>
          </file>`;

  const videoClip = (clip, index) => {
    const videoId = `clipitem-${index + 1}`;
    const audioId = `clipitem-${clips.length + index + 1}`;
    const secondAudioId = `clipitem-${clips.length * 2 + index + 1}`;
    const audioLinks = hasAudio
      ? `
            <link>
              <linkclipref>${audioId}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${index + 1}</clipindex>
            </link>
            <link>
              <linkclipref>${secondAudioId}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>2</trackindex>
              <clipindex>${index + 1}</clipindex>
            </link>`
      : '';

    return `<clipitem id="${videoId}">
            <name>${label}</name>
            <enabled>TRUE</enabled>
            <start>${clip.cursor}</start>
            <end>${clip.cursor + clip.duration}</end>
            <in>${clip.start}</in>
            <out>${clip.end}</out>
            ${index === 0 ? fileBlock : '<file id="file-1" />'}
            <compositemode>normal</compositemode>
            <link>
              <linkclipref>${videoId}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${index + 1}</clipindex>
            </link>${audioLinks}
          </clipitem>`;
  };

  const audioClip = (clip, index, channel) => `<clipitem id="clipitem-${clips.length * channel + index + 1}" premiereChannelType="stereo">
            <name>${label}</name>
            <enabled>TRUE</enabled>
            <start>${clip.cursor}</start>
            <end>${clip.cursor + clip.duration}</end>
            <in>${clip.start}</in>
            <out>${clip.end}</out>
            <file id="file-1" />
            <sourcetrack>
              <mediatype>audio</mediatype>
              <trackindex>${channel}</trackindex>
            </sourcetrack>
          </clipitem>`;

  const audioTracks = hasAudio
    ? `
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track currentExplodedTrackIndex="0" totalExplodedTrackCount="2" premiereTrackType="Stereo">
          <outputchannelindex>1</outputchannelindex>
          ${clips.map((clip, index) => audioClip(clip, index, 1)).join('\n          ')}
        </track>
        <track currentExplodedTrackIndex="1" totalExplodedTrackCount="2" premiereTrackType="Stereo">
          <outputchannelindex>2</outputchannelindex>
          ${clips.map((clip, index) => audioClip(clip, index, 2)).join('\n          ')}
        </track>
      </audio>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="5">
  <sequence explodedTracks="true">
    <name>${label}</name>
    <duration>${totalFrames}</duration>
    ${rateXml}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${widthValue}</width>
            <height>${heightValue}</height>
            <pixelaspectratio>square</pixelaspectratio>
            ${rateXml}
          </samplecharacteristics>
        </format>
        <track>
          ${clips.map(videoClip).join('\n          ')}
        </track>
      </video>${audioTracks}
    </media>
  </sequence>
</xmeml>
`;
}

/* --------------------------------------------------- Final Cut Pro / DaVinci */

/**
 * FCPXML is shared by DaVinci Resolve and Final Cut Pro: same spine, same
 * asset, only the schema version differs (1.10 for Resolve, 1.11 for FCP).
 * @param {object} options
 * @param {string} options.name source file name
 * @param {string} options.mediaPath path used by `<media-rep>`
 * @param {number} options.duration source duration, in seconds
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {boolean} options.hasAudio
 * @param {Array<{ start: number, end: number }>} options.segments
 * @param {'1.10'|'1.11'} version
 * @returns {string}
 */
function buildFcpxml({ name, mediaPath, duration, width, height, fps, hasAudio, segments }, version) {
  const rate = frameRate(fps);
  const clips = frameSegments(segments, rate);
  if (clips.length === 0) return '';

  const widthValue = Number(width) > 0 ? Math.round(width) : 1920;
  const heightValue = Number(height) > 0 ? Math.round(height) : 1080;
  const sourceFrames = Math.max(1, toFrames(duration, rate));
  const frameDuration = frameTime(1, rate);
  const label = escapeXml(baseName(name));
  const source = escapeXml(mediaUrl(mediaPath || `./${name || 'video.mp4'}`));

  const spine = clips
    .map(
      (clip) =>
        `<asset-clip name="${label}" ref="r2" offset="${frameTime(clip.cursor, rate)}" duration="${frameTime(clip.duration, rate)}" start="${frameTime(clip.start, rate)}" tcFormat="NDF" />`,
    )
    .join('\n            ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="${version}">
  <resources>
    <format id="r1" name="FFVideoFormatRateUndefined" frameDuration="${frameDuration}" width="${widthValue}" height="${heightValue}" colorSpace="1-1-1 (Rec. 709)" />
    <asset id="r2" name="${label}" start="0s" hasVideo="1" format="r1" hasAudio="${hasAudio ? 1 : 0}" audioSources="${hasAudio ? 1 : 0}" audioChannels="${hasAudio ? 2 : 0}" duration="${frameTime(sourceFrames, rate)}">
      <media-rep kind="original-media" src="${source}" />
    </asset>
  </resources>
  <library>
    <event name="Bulkut">
      <project name="${label}">
        <sequence format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            ${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

/** @param {object} options see {@link buildFcpxml} */
export function buildDavinciFcpxml(options) {
  return buildFcpxml(options, '1.10');
}

/** @param {object} options see {@link buildFcpxml} */
export function buildFinalCutFcpxml(options) {
  return buildFcpxml(options, '1.11');
}

/* ------------------------------------------------------------------ Shotcut */

/** @param {number} value @param {number} size */
function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

/**
 * Shotcut reads and writes timecodes as `HH:MM:SS.mmm`.
 * @param {number} seconds
 */
function mltTime(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const rest = (totalMs % 60000) / 1000;
  return `${pad(hours)}:${pad(minutes)}:${rest.toFixed(3).padStart(6, '0')}`;
}

/** @param {number} left @param {number} right */
function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/**
 * Shotcut project (MLT XML). Shotcut builds every cut as its own `<chain>`
 * placed on a video playlist, over a black background track, and the whole
 * project is wrapped in a `<tractor>`.
 * @param {object} options
 * @param {string} options.name source file name
 * @param {string} options.mediaPath path stored in `resource`
 * @param {number} options.duration source duration, in seconds
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {boolean} options.hasAudio
 * @param {Array<{ start: number, end: number }>} options.segments
 * @returns {string}
 */
export function buildShotcutMlt({ name, mediaPath, duration, width, height, fps, hasAudio, segments }) {
  const rate = frameRate(fps);
  const clips = frameSegments(segments, rate);
  if (clips.length === 0) return '';

  const widthValue = Number(width) > 0 ? Math.round(width) : 1920;
  const heightValue = Number(height) > 0 ? Math.round(height) : 1080;
  const divisor = greatestCommonDivisor(widthValue, heightValue);
  const label = escapeXml(baseName(name));
  const resource = escapeXml(String(mediaPath || `./${name || 'video.mp4'}`));
  const totalFrames = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const total = mltTime(totalFrames / rate.fps);
  const sourceTime = (frames) => mltTime(frames / rate.fps);

  const chains = clips
    .map(
      (clip, index) => `  <chain id="chain${index}" out="${sourceTime(clip.end)}">
    <property name="length">${sourceTime(clip.end)}</property>
    <property name="resource">${resource}</property>
    <property name="caption">${label}</property>
  </chain>`,
    )
    .join('\n');

  const entries = clips
    .map(
      (clip, index) =>
        `    <entry producer="chain${index}" in="${sourceTime(clip.start)}" out="${sourceTime(clip.end)}" />`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mlt LC_NUMERIC="C" version="7.9.0" title="Bulkut" producer="main_bin">
  <profile description="automatic" width="${widthValue}" height="${heightValue}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${widthValue / divisor}" display_aspect_den="${heightValue / divisor}" frame_rate_num="${rate.denominator}" frame_rate_den="${rate.numerator}" colorspace="709" />
  <playlist id="main_bin">
    <property name="xml_retain">1</property>
  </playlist>
  <producer id="bg">
    <property name="length">${total}</property>
    <property name="eof">pause</property>
    <property name="resource">#000</property>
    <property name="mlt_service">color</property>
    <property name="mlt_image_format">rgba</property>
    <property name="aspect_ratio">1</property>
  </producer>
  <playlist id="background">
    <entry producer="bg" in="00:00:00.000" out="${total}" />
  </playlist>
${chains}
  <playlist id="playlist0">
    <property name="shotcut:video">1</property>
    <property name="shotcut:name">V1</property>
${entries}
  </playlist>
  <tractor id="tractor0" in="00:00:00.000" out="${total}">
    <property name="shotcut">1</property>
    <property name="shotcut:projectAudioChannels">${hasAudio ? 2 : 0}</property>
    <track producer="background" />
    <track producer="playlist0" />
  </tractor>
</mlt>
`;
}

/* ----------------------------------------------------------------- service */

/**
 * @param {object} options
 * @param {'premiere'|'davinci'|'shotcut'|'finalcut'|'vegas'} options.format
 * @param {string} options.name
 * @param {string} options.mediaPath
 * @param {number} options.duration
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {boolean} options.hasAudio
 * @param {Array<{ start: number, end: number }>} options.segments
 * @returns {string}
 */
export function buildTimeline(options) {
  switch (options.format) {
    case 'davinci':
      return buildDavinciFcpxml(options);
    case 'finalcut':
      return buildFinalCutFcpxml(options);
    case 'shotcut':
      return buildShotcutMlt(options);
    case 'premiere':
    case 'vegas':
      return buildPremiereXml(options);
    default:
      return '';
  }
}
