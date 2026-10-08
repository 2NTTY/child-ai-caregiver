// Register native window history observation before Expo installs its router listener.
import "./src/preview/browser-history-events";
// Expo Router must remain the final entry import (web, native and static rendering).
import "expo-router/entry";
