import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PhotoPreview } from '../src/components/PhotoPreview';
import { prepareImage, type PreparedImage } from '../src/lib/image';
import { prepareReportLocation, ReportClientError, submitReport, type ReportResult } from '../src/lib/reports';
import type { Coordinates } from '../src/lib/location';

export default function NewReportScreen() {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | undefined>();
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  useEffect(() => () => {
    if (image?.uri.startsWith('blob:')) URL.revokeObjectURL(image.uri);
  }, [image]);

  async function choosePhoto(useCamera: boolean) {
    setMessage('');
    setShowSettings(false);
    const picked = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (picked.canceled) return;
    try {
      const prepared = await prepareImage(picked.assets[0]);
      setImage((previous) => {
        if (previous?.uri.startsWith('blob:')) URL.revokeObjectURL(previous.uri);
        return prepared;
      });
      setUploadedPath(undefined); setResult(null);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Image preparation failed.'); }
  }

  async function submit() {
    if (!image) { setMessage('Choose or capture a photo first.'); return; }
    setBusy(true); setMessage(''); setShowSettings(false);
    try {
      const nextCoordinates = coordinates ?? await prepareReportLocation();
      setCoordinates(nextCoordinates);
      const submitted = await submitReport(image, nextCoordinates, uploadedPath);
      setUploadedPath(submitted.imagePath);
      setResult(submitted);
      setMessage('Report submitted.');
    } catch (error) {
      const reportError = error instanceof ReportClientError ? error : null;
      if (reportError?.imagePath) setUploadedPath(reportError.imagePath);
      const text = error instanceof Error ? error.message : 'Submission failed.';
      setShowSettings(text.startsWith('Location permission is required.'));
      setMessage(text);
    } finally { setBusy(false); }
  }

  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Text>New road-damage report</Text>
    <View>
      <Pressable onPress={() => choosePhoto(false)}><Text>Choose photo</Text></Pressable>
      <Pressable onPress={() => choosePhoto(true)}><Text>Take photo</Text></Pressable>
    </View>
    {image && <PhotoPreview image={image} onReselect={() => choosePhoto(false)} />}
    <Pressable disabled={busy} onPress={submit}><Text>{busy ? 'Submitting...' : 'Capture GPS and submit'}</Text></Pressable>
    {showSettings && <Pressable onPress={() => Linking.openSettings()}><Text>Open Settings to review permissions</Text></Pressable>}
    {!!message && <Text>{message}</Text>}
    {result && <View>
      <Text>Result</Text>
      <Text>Damage type: {result.damage_type}</Text>
      <Text>Severity: {result.severity ?? 'unknown'}</Text>
      <Text>Priority: {result.priority_score ?? 'unknown'} ({result.priority_band ?? 'unknown'})</Text>
      <Text>Road type: {result.road_type}</Text>
      {result.address_label && <Text>Address: {result.address_label}</Text>}
      {result.needs_human_review && <Text>This result needs human review because AI confidence was low.</Text>}
      <Text>This is an AI estimate, not an engineering assessment.</Text>
    </View>}
  </ScrollView>;
}
