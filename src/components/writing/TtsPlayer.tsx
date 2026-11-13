// TTS 朗读校对播放器（P84）：系统语音（Web Speech API），按句队列朗读，语速/语音可选。
// 离线可用；无系统语音时明确提示。不修改正文；切章/关闭即停止。
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";

function splitSentences(text: string): string[] {
  return String(text || "")
    .split(/(?<=[。！？!?…\n])/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function TtsPlayer({ text, title, onClose }: { text: string; title: string; onClose: () => void }) {
  const sentences = useMemo(() => splitSentences(text), [text]);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [engine, setEngine] = useState<"system" | "external">("system");
  const [engineError, setEngineError] = useState("");
  const playingRef = useRef(false);
  const indexRef = useRef(0);
  const rateRef = useRef(1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const engineRef = useRef<"system" | "external">("system");
  const externalUrlRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await window.novelAPI.getTtsConfig();
        if (!active) return;
        setEngine(config.engine);
        engineRef.current = config.engine;
        externalUrlRef.current = config.externalUrl;
      } catch { /* 配置不可用时用系统语音 */ }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (!voiceRef.current) {
        const zh = list.find((voice) => voice.lang.startsWith("zh")) || list[0] || null;
        voiceRef.current = zh;
        if (zh) setVoiceURI(zh.voiceURI);
      }
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      playingRef.current = false;
    };
  }, [supported]);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }

  function speakSentence(position: number) {
    if (position >= sentences.length) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    indexRef.current = position;
    setIndex(position);
    if (engineRef.current === "external" && externalUrlRef.current) {
      void (async () => {
        try {
          const response = await fetch(externalUrlRef.current, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sentences[position], rate: rateRef.current }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!playingRef.current) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            if (playingRef.current) speakSentence(position + 1);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            playingRef.current = false;
            setPlaying(false);
            setEngineError("外部引擎音频播放失败");
          };
          await audio.play();
          setEngineError("");
        } catch (error) {
          playingRef.current = false;
          setPlaying(false);
          setEngineError(`外部 TTS 引擎不可用（${error instanceof Error ? error.message : error}），可在设置切回系统语音`);
        }
      })();
      return;
    }
    if (!supported) return;
    const utterance = new SpeechSynthesisUtterance(sentences[position]);
    utterance.rate = rateRef.current;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onend = () => {
      if (playingRef.current) speakSentence(position + 1);
    };
    utterance.onerror = () => {
      playingRef.current = false;
      setPlaying(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  function play() {
    if (!sentences.length) return;
    if (engineRef.current === "system") {
      if (!supported) return;
      window.speechSynthesis.cancel();
    } else {
      stopAudio();
    }
    playingRef.current = true;
    setPlaying(true);
    speakSentence(indexRef.current >= sentences.length ? 0 : indexRef.current);
  }

  function pause() {
    if (engineRef.current === "external") {
      if (audioRef.current) {
        if (playingRef.current) audioRef.current.pause();
        else void audioRef.current.play();
      }
      playingRef.current = !playingRef.current;
      setPlaying(playingRef.current);
      return;
    }
    if (!supported) return;
    if (playingRef.current) {
      window.speechSynthesis.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      window.speechSynthesis.resume();
      playingRef.current = true;
      setPlaying(true);
    }
  }

  function stop() {
    playingRef.current = false;
    setPlaying(false);
    if (engineRef.current === "external") stopAudio();
    else if (supported) window.speechSynthesis.cancel();
    indexRef.current = 0;
    setIndex(0);
  }

  function changeRate(next: number) {
    rateRef.current = next;
    setRate(next);
    if (playingRef.current) {
      if (engineRef.current === "external") stopAudio();
      else if (supported) window.speechSynthesis.cancel();
      speakSentence(indexRef.current);
    }
  }

  function changeVoice(uri: string) {
    const voice = voices.find((item) => item.voiceURI === uri) || null;
    voiceRef.current = voice;
    setVoiceURI(uri);
    if (playingRef.current && engineRef.current === "system" && supported) {
      window.speechSynthesis.cancel();
      speakSentence(indexRef.current);
    }
  }

  const externalMode = engine === "external";
  return (
    <div className="tts-player" role="region" aria-label="朗读校对">
      <Volume2 size={15} />
      <span className="tts-title" title={title}>{title || "当前章节"}</span>
      <span className="tts-status">{externalMode ? "外部引擎" : "系统语音"}</span>
      {!externalMode && !supported ? (
        <span className="tts-status">当前环境不支持语音朗读</span>
      ) : !externalMode && voices.length === 0 ? (
        <span className="tts-status">正在加载系统语音…（若始终为空，请在系统设置安装语音包）</span>
      ) : (
        <>
          <button disabled={!sentences.length} onClick={play} title="从头/当前句朗读"><Play size={14} /> 朗读</button>
          <button onClick={pause} title="暂停/继续">{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "暂停" : "继续"}</button>
          <button onClick={stop} title="停止"><Square size={14} /> 停止</button>
          <label className="tts-control">
            语速
            <select value={rate} onChange={(event) => changeRate(Number(event.target.value))}>
              {[0.7, 0.85, 1, 1.15, 1.3, 1.5].map((value) => <option key={value} value={value}>{value}x</option>)}
            </select>
          </label>
          {!externalMode && (
            <label className="tts-control">
              语音
              <select value={voiceURI} onChange={(event) => changeVoice(event.target.value)}>
                {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}（{voice.lang}）</option>)}
              </select>
            </label>
          )}
          <span className="tts-status">{sentences.length ? `${index + 1}/${sentences.length} 句` : "无正文"}</span>
        </>
      )}
      <button onClick={onClose} title="关闭朗读">关闭</button>
      {engineError && <p className="tts-current" role="alert">{engineError}</p>}
      {!engineError && sentences.length > 0 && (
        <p className="tts-current" aria-live="polite">{sentences[index]}</p>
      )}
    </div>
  );
}