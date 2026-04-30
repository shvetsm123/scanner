import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type DimensionValue,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { M } from '../constants/mamaTheme';
import {
  fetchCreatorSubmissions,
  submitCreatorSubmission,
  validateCreatorSubmission,
  type CreatorContactType,
  type CreatorSubmission,
} from '../src/lib/creatorSubmissions';

type LocalVideoSource = number;

type ExampleVideo = {
  id: string;
  title: string;
  subtitle: string;
  source: LocalVideoSource;
  thumbnailSource: ImageSourcePropType | null;
};

const exampleVideos: ExampleVideo[] = [
  {
    id: 'scan-home',
    title: 'Scan at home',
    subtitle: 'Show how you scan a product in your kitchen.',
    source: require('../assets/videos/example-scan-home.mp4'),
    thumbnailSource: require('../assets/videos/thumbnails/example-scan-home.png'),
  },
  {
    id: 'compare-products',
    title: 'Compare two products',
    subtitle: 'Pick two snacks and show which one KidLens prefers.',
    source: require('../assets/videos/example-compare-products.mp4'),
    thumbnailSource: require('../assets/videos/thumbnails/example-compare-products.png'),
  },
  {
    id: 'surprising-result',
    title: 'Surprising result',
    subtitle: 'Scan something that looks healthy but gets flagged.',
    source: require('../assets/videos/example-surprising-result.mp4'),
    thumbnailSource: require('../assets/videos/thumbnails/example-surprising-result.png'),
  },
  {
    id: 'parent-takeaway',
    title: 'Parent takeaway',
    subtitle: 'Share what you learned after scanning.',
    source: require('../assets/videos/example-parent-takeaway.mp4'),
    thumbnailSource: require('../assets/videos/thumbnails/example-parent-takeaway.png'),
  },
];

const contactOptions: { value: CreatorContactType; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'other', label: 'Other' },
];

function contactPlaceholder(contactType: CreatorContactType): string {
  if (contactType === 'email') {
    return 'you@example.com';
  }
  if (contactType === 'instagram' || contactType === 'tiktok') {
    return '@username';
  }
  return 'How can we contact you?';
}

function shortenUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, '');
    const shortPath = path.length > 28 ? `${path.slice(0, 28)}...` : path;
    return `${url.hostname}${shortPath}`;
  } catch {
    return rawUrl.length > 42 ? `${rawUrl.slice(0, 42)}...` : rawUrl;
  }
}

function formatCreatedDate(rawDate: string): string {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function getSubmissionStatusBadge(status: CreatorSubmission['status']): {
  label: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  if (status === 'selected' || status === 'paid') {
    return {
      label: status === 'paid' ? 'Paid' : 'Selected',
      backgroundColor: M.sageWash,
      borderColor: M.lineSage,
      textColor: M.sageDeep,
    };
  }
  if (status === 'not_selected' || status === 'rejected') {
    return {
      label: 'Not selected',
      backgroundColor: M.bgCardMuted,
      borderColor: M.line,
      textColor: M.textMuted,
    };
  }
  return {
    label: 'Pending',
    backgroundColor: M.bgChipSelected,
    borderColor: M.line,
    textColor: M.textMuted,
  };
}

const ExampleVideoCard = memo(function ExampleVideoCard({
  example,
  isPlaying,
  onToggle,
  width,
}: {
  example: ExampleVideo;
  isPlaying: boolean;
  onToggle: (id: string) => void;
  width: DimensionValue;
}) {
  const player = useVideoPlayer(example.source, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = false;
    videoPlayer.pause();
  });

  useEffect(() => {
    if (isPlaying) {
      player.play();
      return;
    }
    player.pause();
    player.currentTime = 0;
  }, [isPlaying, player]);

  return (
    <Pressable
      onPress={() => onToggle(example.id)}
      style={({ pressed }) => ({
        width,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <View style={{ marginBottom: 7 }}>
        <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '800', color: M.text }}>
          {example.title}
        </Text>
        <Text style={{ marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: '600', color: M.textMuted }}>
          {example.subtitle}
        </Text>
      </View>
      <View
        style={{
          width: '100%',
          aspectRatio: 9 / 16,
          borderRadius: M.r20,
          backgroundColor: M.bgChipSelected,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: M.line,
          ...M.shadowSoft,
        }}
      >
        {isPlaying ? (
          <VideoView
            player={player}
            nativeControls={false}
            contentFit="cover"
            fullscreenOptions={{ enable: false }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : example.thumbnailSource ? (
          <Image source={example.thumbnailSource} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: M.bgCardMuted,
            }}
          >
            <Text style={{ fontSize: 34, opacity: 0.9 }}>🎥</Text>
          </View>
        )}
        {!isPlaying ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(30, 24, 18, 0.08)',
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                backgroundColor: 'rgba(255, 252, 247, 0.88)',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: 'rgba(230, 221, 210, 0.9)',
              }}
            >
              <Text style={{ marginLeft: 3, fontSize: 20, color: M.text }}>▶</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export default function ShareVideoScreen() {
  const [videoUrl, setVideoUrl] = useState('');
  const [contactType, setContactType] = useState<CreatorContactType>('email');
  const [contactValue, setContactValue] = useState('');
  const [submissions, setSubmissions] = useState<CreatorSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [examplesVisible, setExamplesVisible] = useState(false);
  const [playingExampleId, setPlayingExampleId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isNarrowAndroid = Platform.OS === 'android' && windowWidth < 390;
  const horizontalPadding = isNarrowAndroid ? 20 : 24;
  const exampleCardWidth = isNarrowAndroid ? '100%' : '48%';

  const validationMessage = useMemo(
    () =>
      videoUrl.trim() || contactValue.trim()
        ? validateCreatorSubmission({ videoUrl, contactType, contactValue })
        : 'Add a video link and contact details.',
    [contactType, contactValue, videoUrl],
  );
  const canSubmit = !submitting && !validationMessage;

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const result = await fetchCreatorSubmissions();
      setSubmissions(result.submissions);
      setHistoryWarning(result.warning);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

  const onSubmit = async () => {
    const currentValidation = validateCreatorSubmission({ videoUrl, contactType, contactValue });
    if (currentValidation) {
      setError(currentValidation);
      return;
    }
    setSubmitting(true);
    setError(null);
    setSubmitted(false);
    try {
      const result = await submitCreatorSubmission({ videoUrl, contactType, contactValue });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSubmitted(true);
      setVideoUrl('');
      setContactType('email');
      setContactValue('');
      await loadHistory();
    } finally {
      setSubmitting(false);
    }
  };

  const closeExamples = useCallback(() => {
    setPlayingExampleId(null);
    setExamplesVisible(false);
  }, []);

  const toggleExamplePlayback = useCallback((id: string) => {
    setPlayingExampleId((current) => (current === id ? null : id));
  }, []);

  const openSubmissionLink = useCallback(async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('Unable to open link');
      return;
    }
    await Linking.openURL(url);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: M.bgPage }} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: horizontalPadding,
            paddingTop: 4,
            paddingBottom: Math.max(48, insets.bottom + 28),
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              paddingVertical: 8,
              paddingRight: 12,
              marginBottom: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 17, color: M.textMuted, fontWeight: '700', marginRight: 6 }}>←</Text>
            <Text style={{ fontSize: 16, color: M.textMuted, fontWeight: '600' }}>Back</Text>
          </Pressable>

          <Text
            style={{
              fontSize: isNarrowAndroid ? 27 : 30,
              lineHeight: isNarrowAndroid ? 33 : 36,
              fontWeight: '700',
              color: M.text,
            }}
          >
            Share your KidLens video
          </Text>
          <Text style={{ marginTop: 9, fontSize: 15, lineHeight: 22, color: M.textMuted }}>
            Post a short video showing KidLens AI in use. Submit your link below — best videos get rewarded.
          </Text>

          <Pressable
            onPress={() => setExamplesVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="See example videos"
            style={({ pressed }) => ({
              marginTop: 24,
              borderRadius: M.r18,
              backgroundColor: M.bgCardMuted,
              borderWidth: 1,
              borderColor: M.line,
              paddingVertical: 14,
              paddingHorizontal: 15,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? 0.72 : 1,
              ...M.shadowSoft,
            })}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                backgroundColor: M.bgChipSelected,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
            <Ionicons name="color-palette-outline" size={18} color={M.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '800', color: M.text }}>
                Need inspiration?
              </Text>
              <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: M.textMuted }}>
                See example videos
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={M.textSoft} />
            </Pressable>

          <View
            style={{
              marginTop: 24,
              borderRadius: M.r22,
              backgroundColor: M.bgCard,
              borderWidth: 1,
              borderColor: M.line,
              padding: 18,
              ...M.shadowSoft,
            }}
          >
            <View>
              <Text style={{ fontSize: 13, fontWeight: '800' }}>Video link</Text>
              <TextInput
                value={videoUrl}
                onChangeText={(value) => {
                  setError(null);
                  setSubmitted(false);
                  setVideoUrl(value);
                }}
                placeholder={isNarrowAndroid ? 'Paste your video link' : 'Paste your video link'}
                placeholderTextColor={M.textSoft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                maxLength={500}
                style={{
                  marginTop: 8,
                  borderRadius: M.r14,
                  borderWidth: 1,
                  borderColor: M.line,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  fontSize: 16,
                  lineHeight: 22,
                  color: M.text,
                  backgroundColor: M.bgChip,
                }}
              />
            </View>

            <View style={{ marginTop: 18 }}>
              <Text style={{ fontSize: 13, fontWeight: '800' }}>Contact method</Text>
              <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {contactOptions.map((option) => {
                  const selected = contactType === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        setError(null);
                        setContactType(option.value);
                      }}
                      style={({ pressed }) => ({
                        flexBasis: isNarrowAndroid ? '47%' : '22%',
                        flexGrow: 1,
                        flexShrink: 1,
                        borderRadius: M.r14,
                        borderWidth: 1,
                        borderColor: selected ? M.lineSage : M.line,
                        backgroundColor: selected ? M.sageWash : M.bgChip,
                        paddingVertical: 11,
                        alignItems: 'center',
                        opacity: pressed ? 0.72 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          lineHeight: 18,
                          fontWeight: '800',
                          color: selected ? M.sageDeep : M.textMuted,
                          textAlign: 'center',
                        }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ marginTop: 18 }}>
              <Text style={{ fontSize: 13, fontWeight: '800' }}>Contact</Text>
              <TextInput
                value={contactValue}
                onChangeText={(value) => {
                  setError(null);
                  setSubmitted(false);
                  setContactValue(value);
                }}
                placeholder={contactPlaceholder(contactType)}
                placeholderTextColor={M.textSoft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={contactType === 'email' ? 'email-address' : 'default'}
                returnKeyType="done"
                maxLength={120}
                onSubmitEditing={onSubmit}
                style={{
                  marginTop: 8,
                  borderRadius: M.r14,
                  borderWidth: 1,
                  borderColor: M.line,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  fontSize: 16,
                  lineHeight: 22,
                  color: M.text,
                  backgroundColor: M.bgChip,
                }}
              />
            </View>

            {error ? (
              <Text style={{ marginTop: 14, fontSize: 13, lineHeight: 18, color: '#9A4D3C', fontWeight: '700' }}>
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => ({
                marginTop: 20,
                borderRadius: M.r16,
                backgroundColor: canSubmit ? M.inkButton : M.textSoft,
                alignItems: 'center',
                paddingVertical: 15,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={M.cream} />
              ) : (
              <Text style={{ fontSize: 16, lineHeight: 21, fontWeight: '800', color: M.cream, textAlign: 'center' }}>
                Submit video
              </Text>
              )}
            </Pressable>
          </View>

          {submitted ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: M.r16,
                backgroundColor: M.sageWash,
                borderWidth: 1,
                borderColor: M.lineSage,
                paddingVertical: 13,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ fontSize: 15, lineHeight: 20, color: M.sageDeep, fontWeight: '800' }}>
                Submitted — thanks!
              </Text>
              <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 19, color: M.sageDeep, fontWeight: '600' }}>
                We review submissions weekly. If selected, we’ll contact you.
              </Text>
            </View>
          ) : null}

          <View style={{ marginTop: 28 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: M.text }}>Your submissions</Text>
            {historyWarning ? (
              <Text style={{ marginTop: 8, fontSize: 12, lineHeight: 17, color: M.textSoft, fontWeight: '600' }}>
                {historyWarning}
              </Text>
            ) : null}
            {loadingHistory ? (
              <View style={{ paddingVertical: 22, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={M.textSoft} />
              </View>
            ) : submissions.length === 0 ? (
              <Text style={{ marginTop: 12, fontSize: 14, color: M.textSoft, fontWeight: '600', fontStyle: 'italic' }}>
                No submissions yet
              </Text>
            ) : (
              <View style={{ marginTop: 12, gap: 10 }}>
                {submissions.map((submission) => {
                  const statusBadge = getSubmissionStatusBadge(submission.status);
                  return (
                    <Pressable
                      key={submission.id}
                      onPress={() => void openSubmissionLink(submission.video_url)}
                      style={({ pressed }) => ({
                        borderRadius: M.r18,
                        backgroundColor: M.bgCard,
                        borderWidth: 1,
                        borderColor: M.line,
                        paddingVertical: 13,
                        paddingHorizontal: 14,
                        opacity: pressed ? 0.72 : 1,
                      })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 14, lineHeight: 19, fontWeight: '800', color: M.text }} numberOfLines={2}>
                            {shortenUrl(submission.video_url)}
                          </Text>
                          <Text style={{ marginTop: 6, fontSize: 12, color: M.textMuted, fontWeight: '600' }}>
                            {formatCreatedDate(submission.created_at)}
                          </Text>
                        </View>
                        <View
                          style={{
                            borderRadius: 999,
                            backgroundColor: statusBadge.backgroundColor,
                            borderWidth: 1,
                            borderColor: statusBadge.borderColor,
                            paddingVertical: 5,
                            paddingHorizontal: 9,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '800', color: statusBadge.textColor }}>
                            {statusBadge.label}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={examplesVisible}
        transparent
        animationType="slide"
        onRequestClose={closeExamples}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <View
            style={{
              height: Math.round(windowHeight * 0.93),
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: M.bgPage,
              paddingTop: 20,
              paddingBottom: Math.max(26, insets.bottom + 12),
              ...M.shadowCard,
            }}
          >
            <View style={{ paddingHorizontal: horizontalPadding }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: M.text }}>
                    Example videos
                  </Text>
                  <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, fontWeight: '600', color: M.textMuted }}>
                    Use these as inspiration for your own post.
                  </Text>
                </View>
                <Pressable
                  onPress={closeExamples}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={({ pressed }) => ({
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    backgroundColor: M.bgChipSelected,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: 22, lineHeight: 24, color: M.textMuted }}>×</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: horizontalPadding,
                paddingTop: 18,
                paddingBottom: 28,
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                rowGap: 16,
              }}
            >
              {exampleVideos.map((example) => (
                <ExampleVideoCard
                  key={example.id}
                  example={example}
                  isPlaying={playingExampleId === example.id}
                  onToggle={toggleExamplePlayback}
                  width={exampleCardWidth}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
