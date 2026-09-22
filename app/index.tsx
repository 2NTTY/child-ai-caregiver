import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        育伴港
      </Text>
      <Text style={styles.body}>本機基礎工程</Text>
      <Text style={styles.body}>
        登入及資料儲存尚未接通，目前未能建立或保存孩子與照顧記錄。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 12,
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
});
