import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Animated, Platform, TextInput, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../api';
import { COLORS } from '../theme';

const PALETTE = ['#0d6efd', '#f97316', '#16a34a', '#dc2626', '#7c3aed'];
const PANEL_H = 340;
const BTN = 50;
// Position initiale : droite / haut (loin des contrôles vidéo en bas)
const INIT_BOTTOM = 120;
const INIT_RIGHT = 16;

function uid() { return Math.random().toString(36).slice(2, 10); }

export default function WhiteboardPanel({ slotId, isHost }) {
  const [open, setOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Position draggable de la bulle (stockée en bottom/right relatif à l'écran)
  const dragPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const basePos = useRef({ x: 0, y: 0 }); // valeurs absolues px accumulées entre drags
  const isDragging = useRef(false);
  const socketRef = useRef(null);
  const myColor = PALETTE[isHost ? 0 : 1];

  // blocks: { id, x (0–1), y (0–1), text, color }
  const [blocks, setBlocks] = useState([]);
  const boardRef = useRef(null);
  const boardSize = useRef({ w: 1, h: 1 });

  // Socket.io
  useEffect(() => {
    if (!slotId) return;
    let s;
    try {
      const { io } = require('socket.io-client');
      const base = API_BASE || (typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : 'http://localhost:3000');
      s = io(base, { path: '/wb', query: { room: String(slotId) }, transports: ['websocket', 'polling'] });
    } catch (e) {
      console.warn('[whiteboard] socket.io-client unavailable:', e.message);
      return;
    }
    socketRef.current = s;

    s.on('text_update', (block) => setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === block.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...block }; return n; }
      return [...prev, block];
    }));
    s.on('text_delete', ({ id }) => setBlocks((prev) => prev.filter((b) => b.id !== id)));
    s.on('clear', () => setBlocks([]));

    return () => s.disconnect();
  }, [slotId]);

  const toggle = useCallback(() => {
    if (isDragging.current) return; // ignore tap si c'était un drag
    const toValue = open ? 0 : 1;
    Animated.spring(slideAnim, { toValue, useNativeDriver: true, friction: 18, tension: 200 }).start();
    setOpen((v) => !v);
  }, [open, slideAnim]);

  // PanResponder pour déplacer la bulle
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
      // Petit délai pour distinguer tap de drag
      setTimeout(() => { isDragging.current = false; }, 80);
    },
  })).current;

  const clear = useCallback(() => {
    socketRef.current?.emit('clear');
    setBlocks([]);
  }, []);

  // Tap sur le board → nouveau bloc texte à cet endroit
  const onBoardPress = useCallback((e) => {
    const { locationX, locationY } = e.nativeEvent;
    const w = boardSize.current.w || 1;
    const h = boardSize.current.h || 1;
    const x = locationX / w;
    const y = locationY / h;
    const block = { id: uid(), x, y, text: '', color: myColor };
    setBlocks((prev) => [...prev, block]);
    // Pas d'émission socket tant que le texte est vide
  }, [myColor]);

  const onBoardLayout = useCallback((e) => {
    boardSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  }, []);

  const updateBlock = useCallback((id, text) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, text } : b));
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const updated = { ...block, text };
    socketRef.current?.emit('text_update', updated);
  }, [blocks]);

  const deleteBlock = useCallback((id) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    socketRef.current?.emit('text_delete', { id });
  }, []);

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
          ref={boardRef}
          onLayout={onBoardLayout}
          onPress={onBoardPress}
          style={{ flex: 1, backgroundColor: '#fafbfd', position: 'relative' }}
        >
          {/* Hint si vide */}
          {blocks.length === 0 && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              <Ionicons name="create-outline" size={22} color="#c5cbdb" />
              <Text style={{ fontSize: 11.5, color: '#c5cbdb', marginTop: 6, textAlign: 'center' }}>Tape ici pour écrire</Text>
            </View>
          )}

          {/* Blocs texte */}
          {blocks.map((b) => (
            <View key={b.id} style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%` }} pointerEvents="auto">
              <TextInput
                value={b.text}
                onChangeText={(t) => updateBlock(b.id, t)}
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
