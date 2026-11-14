import { Text, View } from "react-native";
import { Link } from 'expo-router';

export default function Home() {
  return (
    <View>
      <Text>FlowFix</Text>
      <Link href="/new-report">Create a road-damage report</Link>
    </View>
  );
}

