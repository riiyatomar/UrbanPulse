/**
 * UrbanPulse Citizen App — Application Shell
 *
 * Composes AuthScreen (unauthenticated) or Header + screen content + TabBar (authenticated).
 * Authentication is managed by AuthProvider (React Context).
 * Complaints are managed by ComplaintProvider.
 */
import React from 'react';
import { SafeAreaView, View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ComplaintProvider, useComplaints } from './src/context/ComplaintContext';
import Header from './src/components/Header';
import TabBar from './src/components/TabBar';
import ReportScreen from './src/screens/ReportScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import AuthScreen from './src/screens/AuthScreen';
import { colors } from './src/theme/colors';

function AppContent() {
  const { activeTab } = useComplaints();
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <Header userName={user?.name} onLogout={logout} />
      <View style={styles.content}>
        {activeTab === 'report' ? <ReportScreen /> : <HistoryScreen />}
      </View>
      <TabBar />
    </SafeAreaView>
  );
}

function AuthenticatedApp() {
  return (
    <ComplaintProvider>
      <AppContent />
    </ComplaintProvider>
  );
}

function AuthGate() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#58a6ff" />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.deepSlate,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.deepSlate,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#8b949e',
    marginTop: 12,
    fontSize: 14,
  },
});
