import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PhotoPreview } from '../src/components/PhotoPreview';
import { prepareImage, type PreparedImage } from '../src/lib/image';
import { prepareReportLocation } from '../src/lib/reports';
import { uploadReportPhoto } from '../src/lib/reports';

export default function NewReportScreen() {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choosePhoto(useCamera: boolean) {
    setMessage('');
    setShowSettings(false);
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (result.canceled) return;
    try { setImage(await prepareImage(result.assets[0])); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Image preparation failed.'); }
  }

  async function upload() {
    if (!image) { setMessage('Choose or capture a photo first.'); return; }
    setBusy(true); setMessage('');
    try {
      await prepareReportLocation();
      const path = await uploadReportPhoto(image);
      setMessage(`Photo uploaded to private Storage at ${path}. A report row will be created in the next processing step.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Submission failed.';
      setShowSettings(text.startsWith('Location permission is required.'));
      setMessage(text);
    } finally { setBusy(false); }
  }

  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Text>New road-damage report</Text>
    <View><Pressable onPress={() => choosePhoto(false)}><Text>Choose photo</Text></Pressable><Pressable onPress={() => choosePhoto(true)}><Text>Take photo</Text></Pressable></View>
    {image && <PhotoPreview image={image} onReselect={() => choosePhoto(false)} />}
    <Pressable disabled={busy} onPress={upload}><Text>{busy ? 'Uploading…' : 'Capture GPS and upload'}</Text></Pressable>
    {showSettings && <Pressable onPress={() => Linking.openSettings()}><Text>Open Settings to review permissions</Text></Pressable>}
    {!!message && <Text>{message}</Text>}
  </ScrollView>;
}
