import { View, Text } from 'react-native';
import { COLORS } from '../theme';

// Rendu léger du markdown produit par RichTextArea (gras **, italique *,
// souligné __, titres ## , listes à puces « - »/« • »). Volontairement minimal
// (pas de lib) : suffisant pour un résumé / homework de cours.

function parseInline(text, keyBase) {
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*)/g;
  const out = [];
  let last = 0, m, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Text key={`${keyBase}-${i++}`}>{text.slice(last, m.index)}</Text>);
    if (m[2] != null) out.push(<Text key={`${keyBase}-${i++}`} style={{ fontWeight: '800' }}>{m[2]}</Text>);
    else if (m[3] != null) out.push(<Text key={`${keyBase}-${i++}`} style={{ textDecorationLine: 'underline' }}>{m[3]}</Text>);
    else if (m[4] != null) out.push(<Text key={`${keyBase}-${i++}`} style={{ fontStyle: 'italic' }}>{m[4]}</Text>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Text key={`${keyBase}-${i++}`}>{text.slice(last)}</Text>);
  return out.length ? out : [<Text key={`${keyBase}-0`}>{text}</Text>];
}

export default function MarkdownText({ value, style, color = '#1a1a2e', size = 14.5, numberOfLines }) {
  const text = String(value || '');
  // Mode tronqué (collapsible) : on rend tout d'un bloc, sans la mise en forme par
  // ligne (titres/listes), pour que numberOfLines fonctionne proprement.
  if (numberOfLines) {
    return (
      <Text numberOfLines={numberOfLines} style={[{ color, fontSize: size, lineHeight: size * 1.45 }, style]}>
        {parseInline(text, 'x')}
      </Text>
    );
  }
  const lines = text.split('\n');
  return (
    <View style={style}>
      {lines.map((ln, idx) => {
        if (/^##\s+/.test(ln)) {
          return <Text key={idx} style={{ color, fontSize: size + 3, fontWeight: '800', marginTop: idx ? 8 : 0, marginBottom: 2 }}>{parseInline(ln.replace(/^##\s+/, ''), `h${idx}`)}</Text>;
        }
        if (/^[-•]\s+/.test(ln)) {
          return (
            <View key={idx} style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
              <Text style={{ color: COLORS.jiayou, fontSize: size, lineHeight: size * 1.45 }}>•</Text>
              <Text style={{ flex: 1, color, fontSize: size, lineHeight: size * 1.45 }}>{parseInline(ln.replace(/^[-•]\s+/, ''), `b${idx}`)}</Text>
            </View>
          );
        }
        if (ln.trim() === '') return <View key={idx} style={{ height: size * 0.6 }} />;
        return <Text key={idx} style={{ color, fontSize: size, lineHeight: size * 1.45 }}>{parseInline(ln, `p${idx}`)}</Text>;
      })}
    </View>
  );
}
