import React from 'react';
import { Composition } from 'remotion';
import { AcademicComposition } from '../../../../frontend/src/remotion/compositions/AcademicComposition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AcademicShorts"
        component={AcademicComposition as any}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          title: 'Bài Giảng Mẫu',
          brandName: 'AI TEACHING ASSISTANT',
          templateType: 'explainer',
          aspectRatio: '9:16',
          fps: 30,
          totalFrames: 900,
          scenes: [],
        }}
      />
      <Composition
        id="AcademicLecture"
        component={AcademicComposition as any}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          title: 'Bài Giảng Mẫu',
          brandName: 'AI TEACHING ASSISTANT',
          templateType: 'explainer',
          aspectRatio: '16:9',
          fps: 30,
          totalFrames: 900,
          scenes: [],
        }}
      />
    </>
  );
};
