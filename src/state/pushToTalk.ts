import { RefObject, useEffect, useRef, useState } from "react";

export function usePushToTalk(inputRef: RefObject<HTMLTextAreaElement>, submit: () => void, activationCode = "AltRight") {
  const [isPushingToTalk, setIsPushingToTalk] = useState(false);
  const pushingToTalk = useRef(false);
  const keyupAt = useRef(0);
  const finalizeTimer = useRef<number | null>(null);
  const finalizing = useRef(false);
  const submitRef = useRef(submit);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const clearTimer = () => {
    if (finalizeTimer.current) window.clearTimeout(finalizeTimer.current);
    finalizeTimer.current = null;
  };

  const finalize = () => {
    if (finalizing.current) return;
    finalizing.current = true;
    clearTimer();
    if (inputRef.current?.value.trim()) submitRef.current();
    inputRef.current?.blur();
    keyupAt.current = 0;
    window.setTimeout(() => {
      finalizing.current = false;
    }, 80);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onInput = () => {
      if (pushingToTalk.current || !keyupAt.current) return;
      if (performance.now() - keyupAt.current > 5_000) return;
      clearTimer();
      finalizeTimer.current = window.setTimeout(finalize, 350);
    };
    input.addEventListener("input", onInput);
    return () => input.removeEventListener("input", onInput);
  }, [inputRef]);

  useEffect(() => {
    document.body.classList.toggle("is-pushing-to-talk", isPushingToTalk);
    return () => document.body.classList.remove("is-pushing-to-talk");
  }, [isPushingToTalk]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== activationCode || pushingToTalk.current) return;
      event.preventDefault();
      pushingToTalk.current = true;
      setIsPushingToTalk(true);
      clearTimer();
      keyupAt.current = 0;
      inputRef.current?.focus();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== activationCode) return;
      pushingToTalk.current = false;
      setIsPushingToTalk(false);
      keyupAt.current = performance.now();
      finalizeTimer.current = window.setTimeout(finalize, 2_500);
    };
    const onBlur = () => {
      if (!pushingToTalk.current) return;
      pushingToTalk.current = false;
      setIsPushingToTalk(false);
      keyupAt.current = performance.now();
      finalizeTimer.current = window.setTimeout(finalize, 2_500);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      clearTimer();
    };
  }, [activationCode, inputRef]);

  return { isPushingToTalk };
}
