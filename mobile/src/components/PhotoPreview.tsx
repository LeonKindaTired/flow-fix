import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PreparedImage } from '../lib/image';
import { theme } from '../theme';

export function PhotoPreview({ image, onReselect }: { image: PreparedImage; onReselect: () => void }) {
  return <View style={styles.preview}>
    <Image source={{ uri: image.uri }} accessibilityLabel="Selected road-damage photo" style={styles.image} />
    <Text style={styles.meta}>{Math.round(image.size / 1024)} KB · {image.mimeType}</Text>
    <Pressable style={styles.reselect} onPress={onReselect}><Text style={styles.reselectText}>Retake or choose another photo</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  preview: { gap: 10, padding: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusCard },
  image: { width: '100%', height: 210, borderRadius: 6, backgroundColor: theme.raised },
  meta: { color: theme.muted, fontSize: 12 }, reselect: { minHeight: 44, justifyContent: 'center' }, reselectText: { color: theme.strong, fontSize: 14, fontWeight: '500' },
});
