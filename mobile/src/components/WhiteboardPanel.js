import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Animated, Platform, TextInput, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../api';
import { COLORS } from '../theme';

const PALETTE = ['#0d6efd', '#f97316', '#16a34a', '#dc2626', '#7c3aed'];
const PANEL_H = 340;
const BTN = 50;
const INIT_BOTTOM = 120;
const INIT_RIGHT = 16;

function uid() { return Math.random().toString(36).slice(2, 10); }

export default function WhiteboardPanel({ slotId, isHost }) {
  const [open, setOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const dragPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const basePos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const wsRef = useRef(null);
  const myColor = PALETTE[isHost ? 0 : 1];

  const [blocks, setBlocks] = useState([]);
  const boardSize = useRef({ w: 1, h: 1 });

  // Native WebSocket — zero deps, works on Hermes
  useEffect(() => {
    if (!slotId) return;
    const base = API_BASE || (typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : 'http://localhost:3000');
    const wsUrl = base.replace(/^http/, 'ws') + `/wb?room=${slotId}`;
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[whiteboard] WebSocket unavailable:', e.message);
      return;
    }
    wsRef.current = ws;

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'text_update') {
        setBlocks((prev) => {
          const idx = prev.findIndex((b) => b.id === msg.id);
          if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...msg }; return n; }
          return [...prev, msg];
        });
      } else if (msg.type === 'text_delete') {
        setBlocks((prev) => prev.filter((b) => b.id !== msg.id));
      } else if (msg.type === 'clear') {
        setBlocks([]);
      }
    };
    ws.onerror = (e) => console.warn('[whiteboard] ws error', e.message);

    return () => { ws.close(); wsRef.current = null; };
  }, [slotId]);

  const wsSend = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }, []);

  const toggle = useCallback(() => {
    if (isDragging.current) return;
    const toValue = open ? 0 : 1;
    Animated.spring(slideAnim, { toValue, useNativeDriver: true, friction: 18, tension: 200 }).start();
    setOpen((v) => !v);
  }, [open, slideAnim]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
    onPanResponderGrant: () => {
      isDragging.current = false;
      dragPos.setOffset({ x: basePos.current.x, y: basePos.current.y });
      dragPos.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) isDragging.current = true;
      dragPos.setValue({ x: g.dx, y: g.dy });
    },
    onPanResponderRelease: (_, g) => {
      dragPos.flattenOffset();
      basePos.current = { x: basePos.current.x + g.dx, y: basePos.current.y + g.dy };
      setTimeout(() => { isDragging.current = false; }, 80);
    },
  })).current;

  const clear = useCallback(() => {
    wsSend({ type: 'clear' });
    setBlocks([]);
  }, [wsSend]);

  const onBoardPress = useCallback((e) => {
    const { locationX, locationY } = e.nativeEvent;
    const w = boardSize.current.w || 1;
    const h = boardSize.current.h || 1;
    const block = { id: uid(), x: locationX / w, y: locationY / h, text: '', color: myColor };
    setBlocks((prev) => [...prev, block]);
  }, [myColor]);

  const onBoardLayout = useCallback((e) => {
    boardSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  }, []);

  const updateBlock = useCallback((id, text, currentBlocks) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, text } : b));
    const block = currentBlocks.find((b) => b.id === id);
    if (block) wsSend({ type: 'text_update', ...block, text });
  }, [wsSend]);

  const deleteBlock = useCallback((id) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    wsSend({ type: 'text_delete', id });
  }, [wsSend]);

  const panelTranslateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [PANEL_H + 20, 0] });

  return (
    <View style={{ position: 'absolute', bottom: INIT_BOTTOM, right: INIT_RIGHT, alignItems: 'flex-end', zIndex: 1000 }} pointerEvents="box-none">

      {/* Panel */}
      <Animated.View style={{
        transform: [{ translateY: panelTranslateY }],
        opacity: slideAnim,
        pointerEvents: open ? 'auto' : 'none',
        width: 300, height: PANEL_H,
        backgroundColor: '#fff', borderRadius: 18,
        overflow: 'hidden', marginBottom: 10,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18, shadowRadius: 12, elevation: 10, zIndex: 1000,
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f0f2f5', backgroundColor: '#fafbfc' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: myColor }} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#55607a' }}>Board partagé</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Pressable onPress={clear} hitSlop={8}>
              <Ionicons name="trash-outline" size={17} color="#9aa4b2" />
            </Pressable>
            <Pressable onPress={toggle} hitSlop={8}>
              <Ionicons name="chevron-down" size={17} color="#9aa4b2" />
            </Pressable>
          </View>
        </View>

        {/* Zone de board */}
        <Pressable
          onLayout={onBoardLayout}
          onPress={onBoardPress}
          style={{ flex: 1, backgroundColor: '#fafbfd', position: 'relative' }}
        >
          {blocks.length === 0 && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <Ionicons name="create-outline" size={22} color="#c5cbdb" />
              <Text style={{ fontSize: 11.5, color: '#c5cbdb', marginTop: 6, textAlign: 'center' }}>Tape ici pour écrire</Text>
            </View>
          )}

          {blocks.map((b) => (
            <View key={b.id} style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%` }}>
              <TextInput
                value={b.text}
                onChangeText={(t) => updateBlock(b.id, t, blocks)}
                onBlur={() => { if (!b.text.trim()) deleteBlock(b.id); }}
                autoFocus={b.color === myColor && b.text === ''}
                multiline
                placeholder="…"
                placeholderTextColor={b.color + '88'}
                style={{
                  color: b.color,
                  fontSize: 13,
                  fontWeight: '600',
                  minWidth: 60,
                  maxWidth: 160,
                  padding: 4,
                  paddingHorizontal: 6,
                  backgroundColor: b.color + '14',
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: b.color + '44',
                  ...(Platform.OS === 'web' ? { outline: 'none' } : {}),
                }}
              />
            </View>
          ))}
        </Pressable>
      </Animated.View>

      {/* Bouton flottant — draggable */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: dragPos.getTranslateTransform(),
          zIndex: 1001,
          ...(Platform.OS === 'web' ? { cursor: 'grab' } : {}),
        }}
      >
        <Pressable
          onPress={toggle}
          style={{
            width: BTN, height: BTN, borderRadius: BTN / 2,
            backgroundColor: COLORS.jiayou,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.22, shadowRadius: 6, elevation: 8,
            pointerEvents: 'auto',
          }}
        >
          <Ionicons name={open ? 'chevron-down' : 'create-outline'} size={22} color="#fff" />
        </Pressable>
      </Animated.View>
    </View>
  );
}
