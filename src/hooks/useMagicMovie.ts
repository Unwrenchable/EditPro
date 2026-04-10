import { useState, useCallback, useRef } from 'react';
import type { MagicMovieState, MagicMovieStyle, MagicMoviePlan } from '../types';
import { generatePlan, GENERATION_STEPS, detectStyle } from '../utils/magicMovieAI';

const STEP_DELAY_MS = 650;

const initialState: MagicMovieState = {
  prompt: '',
  style: null,
  status: 'idle',
  generationStep: 0,
  plan: null,
  error: null,
};

export function useMagicMovie() {
  const [state, setState] = useState<MagicMovieState>(initialState);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPrompt = useCallback((prompt: string) => {
    setState((prev) => ({ ...prev, prompt }));
  }, []);

  const setStyle = useCallback((style: MagicMovieStyle | null) => {
    setState((prev) => ({ ...prev, style }));
  }, []);

  /** Detect style from the current prompt without generating a plan */
  const previewStyle = useCallback((prompt: string): MagicMovieStyle => {
    return detectStyle(prompt);
  }, []);

  /**
   * Kick off the animated generation sequence, then resolve to a completed plan.
   * If `style` is null in state, it is auto-detected from the prompt.
   */
  const generate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: 'generating',
      generationStep: 0,
      plan: null,
      error: null,
    }));

    let step = 0;

    const advance = () => {
      step += 1;
      if (step < GENERATION_STEPS.length) {
        setState((prev) => ({ ...prev, generationStep: step }));
        timerRef.current = setTimeout(advance, STEP_DELAY_MS);
      } else {
        // Generation complete — build the plan
        setState((prev) => {
          const plan: MagicMoviePlan = generatePlan(prev.prompt, prev.style ?? undefined);
          return {
            ...prev,
            status: 'ready',
            plan,
            // Persist the resolved style so the UI can show which was chosen
            style: plan.style,
          };
        });
      }
    };

    timerRef.current = setTimeout(advance, STEP_DELAY_MS);
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState(initialState);
  }, []);

  const markApplied = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'applied' }));
  }, []);

  return {
    state,
    setPrompt,
    setStyle,
    previewStyle,
    generate,
    reset,
    markApplied,
  };
}
