import { Image, Pressable, Text, View } from 'react-native';
import type { PreparedImage } from '../lib/image';

export function PhotoPreview({ image, onReselect }: { image: PreparedImage; onReselect: () => void }) {
  return (
    <View>
      <Image source={{ uri: image.uri }} accessibilityLabel="Selected road-damage photo" style={{ width: 280, height: 210 }} />
      <Text>{Math.round(image.size / 1024)} KB · {image.mimeType}</Text>
      <Pressable onPress={onReselect}><Text>Retake or choose another photo</Text></Pressable>
    </View>
  );
}
