/**
 * TabBar — Bottom tab navigation (Report / History).
 *
 * 44dp minimum touch targets, animated active indicator,
 * accessibility labels on every tab.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { colors, spacing, radii } from '../theme/colors';
import { useComplaints } from '../context/ComplaintContext';

const TABS = [
  { key: 'report', label: 'Report', icon: '📷' },
  { key: 'history', label: 'History', icon: '📋' },
];

export default function TabBar() {
  const { activeTab, setActiveTab } = useComplaints();
  const indicator = useRef(new Animated.Value(activeTab === 'report' ? 0 : 1)).current;

  useEffect(() => {
    Animated.spring(indicator, {
      toValue: activeTab === 'report' ? 0 : 1,
      useNativeDriver: false,
      tension: 68,
      friction: 10,
    }).start();
  }, [activeTab, indicator]);

  const indicatorLeft = indicator.interpolate({
    inputRange: [0, 1],
    outputRange: ['2%', '52%'],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.indicator, { left: indicatorLeft }]} />
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} tab`}
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.civicNavy,
    height: 64,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: '46%',
    height: 2,
    backgroundColor: colors.teal,
    borderRadius: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    gap: 3,
  },
  icon: {
    fontSize: 20,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.teal,
    fontWeight: '700',
  },
});
