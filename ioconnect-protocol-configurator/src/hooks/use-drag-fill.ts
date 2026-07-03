import { useState, useCallback, useRef, useEffect } from "react";

interface DragFillState {
  startRow: number;
  cols: string[];
  sourceValuesByCol: Record<string, string[]>;
}

interface UseDragFillOptions {
  rows: Record<string, string>[];
  onFill: (col: string, fromRow: number, toRow: number, values: string[]) => void;
}

export function useDragFill({ rows, onFill }: UseDragFillOptions) {
  const [dragState, setDragState] = useState<DragFillState | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const dragStateRef = useRef(dragState);
  const hoverRowRef = useRef(hoverRow);
  const onFillRef = useRef(onFill);

  dragStateRef.current = dragState;
  hoverRowRef.current = hoverRow;
  onFillRef.current = onFill;

  const startDrag = useCallback((rowIdx: number, cols: string[], sourceValuesByCol: Record<string, string[]>) => {
    const state = { startRow: rowIdx, cols, sourceValuesByCol };
    setDragState(state);
    dragStateRef.current = state;
    setHoverRow(rowIdx);
    hoverRowRef.current = rowIdx;
  }, []);

  const onMouseEnterRow = useCallback((rowIdx: number) => {
    if (dragStateRef.current) {
      setHoverRow(rowIdx);
      hoverRowRef.current = rowIdx;
    }
  }, []);

  const endDrag = useCallback(() => {
    const state = dragStateRef.current;
    const hover = hoverRowRef.current;

    if (!state || hover === null || hover === state.startRow) {
      setDragState(null);
      dragStateRef.current = null;
      setHoverRow(null);
      hoverRowRef.current = null;
      return;
    }

    const { startRow, cols } = state;
    const fillStart = hover > startRow ? startRow + 1 : hover;
    const fillEnd = hover > startRow ? hover : startRow - 1;
    if (fillStart > fillEnd) {
      setDragState(null);
      dragStateRef.current = null;
      setHoverRow(null);
      hoverRowRef.current = null;
      return;
    }
    const count = fillEnd - fillStart + 1;

    for (const col of cols) {
      const sourceValues = state.sourceValuesByCol[col] ?? [];
      const values: string[] = [];

      // Detect if sourceValues have a numeric increment pattern
      const numPatterns = sourceValues.map(v => v.match(/^(.*?)(\d+)(\D*)$/));
      const allNumeric = numPatterns.length > 0 && numPatterns.every(m => m !== null);

      if (allNumeric && numPatterns.length >= 2) {
        // Multi-cell with numeric pattern: detect increment
        const nums = numPatterns.map(m => parseInt(m![2], 10));
        const prefix = numPatterns[0]![1];
        const suffix = numPatterns[0]![3];
        const step = nums[nums.length - 1] - nums[nums.length - 2];
        const lastNum = nums[nums.length - 1];
        const direction = hover > startRow ? 1 : -1;
        for (let i = 0; i < count; i++) {
          const newNum = lastNum + (i + 1) * step * direction;
          values.push(`${prefix}${newNum}${suffix}`);
        }
      } else if (allNumeric && numPatterns.length === 1) {
        // Single cell with number: increment by 1
        const [, prefix, numStr, suffix] = numPatterns[0]!;
        const startNum = parseInt(numStr, 10);
        const direction = hover > startRow ? 1 : -1;
        for (let i = 0; i < count; i++) {
          values.push(`${prefix}${startNum + (i + 1) * direction}${suffix}`);
        }
      } else {
        // No numeric pattern: repeat the source values cyclically
        for (let i = 0; i < count; i++) {
          values.push(sourceValues[i % sourceValues.length]);
        }
      }

      const fillValues = hover > startRow ? values : [...values].reverse();
      onFillRef.current(col, fillStart, fillEnd, fillValues);
    }

    setDragState(null);
    dragStateRef.current = null;
    setHoverRow(null);
    hoverRowRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const rowElement = target?.closest("tr[data-row-index]");
      if (!rowElement) return;

      const rowIdx = Number(rowElement.getAttribute("data-row-index"));
      if (Number.isNaN(rowIdx) || rowIdx === hoverRowRef.current) return;

      setHoverRow(rowIdx);
      hoverRowRef.current = rowIdx;
    };

    const handleMouseUp = () => endDrag();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, endDrag]);

  const isHighlighted = useCallback(
    (rowIdx: number, col: string) => {
      if (!dragState || hoverRow === null || !dragState.cols.includes(col)) return false;
      if (hoverRow > dragState.startRow) {
        return rowIdx > dragState.startRow && rowIdx <= hoverRow;
      } else {
        return rowIdx >= hoverRow && rowIdx < dragState.startRow;
      }
    },
    [dragState, hoverRow]
  );

  const getHighlightBorders = useCallback(
    (rowIdx: number, col: string): { top: boolean; bottom: boolean; left: boolean; right: boolean } | null => {
      if (!dragState || hoverRow === null || !dragState.cols.includes(col)) return null;
      const fillStart = hoverRow > dragState.startRow ? dragState.startRow + 1 : hoverRow;
      const fillEnd   = hoverRow > dragState.startRow ? hoverRow : dragState.startRow - 1;
      if (rowIdx < fillStart || rowIdx > fillEnd) return null;
      return {
        top:    rowIdx === fillStart,
        bottom: rowIdx === fillEnd,
        left:   col === dragState.cols[0],
        right:  col === dragState.cols[dragState.cols.length - 1],
      };
    },
    [dragState, hoverRow]
  );

  const isDragging = dragState !== null;

  return { startDrag, onMouseEnterRow, endDrag, isHighlighted, isDragging, getHighlightBorders };
}
