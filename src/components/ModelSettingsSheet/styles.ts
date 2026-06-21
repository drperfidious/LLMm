import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  sheetScrollViewContainer: {
    padding: 16,
  },
  secondaryButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  multimodalDivider: {
    marginVertical: 16,
  },
  multimodalSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  profileDescription: {
    opacity: 0.72,
    marginBottom: 12,
  },
  profileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  profileInput: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  profileSettingBlock: {
    marginTop: 12,
  },
  profileLabel: {
    marginBottom: 8,
  },
  profileChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileSwitchRow: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
});
