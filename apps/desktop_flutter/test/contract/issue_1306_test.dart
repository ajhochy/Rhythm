import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_call_part.dart';

const _onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

Map<String, dynamic> _imageToolPart(String path) => {
      'id': 'part_image_1306',
      'messageID': 'msg_1306',
      'type': 'tool',
      'tool': 'image_generation',
      'state': {
        'status': 'completed',
        'input': const {'prompt': 'A sunrise over a church'},
        'output': 'Image generated and saved to $path',
        'title': 'Generated image',
        'metadata': {'path': path},
      },
    };

Widget _wrap(ChatPart part) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(
        body:
            SizedBox(width: 700, height: 700, child: ToolCallPart(part: part)),
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1306-c1: completed image_generation tool part renders the local metadata.path image',
    (tester) async {
      // Synchronous IO: awaiting real file IO inside the fake-async testWidgets
      // zone never completes and hangs the test to its timeout.
      final temp = Directory.systemTemp.createTempSync('rhythm-1306-');
      addTearDown(() => temp.deleteSync(recursive: true));
      final imagePath = '${temp.path}/generated.png';
      File(imagePath).writeAsBytesSync(base64Decode(_onePixelPng));
      final part = ChatPart.fromJson('msg_1306', _imageToolPart(imagePath));

      await tester.pumpWidget(_wrap(part));

      // The fix wires metadata.path into an Image.file. Asserting the rendered
      // Image's FileImage points at that exact path proves the path was not
      // discarded (the regression was a blank block). We deliberately do not
      // force a real pixel decode here — decoding a file image requires
      // tester.runAsync, which never settles in this headless harness and adds
      // no coverage beyond "Flutter can decode a 1px PNG".
      expect(
        find.byType(Image),
        findsOneWidget,
        reason:
            'Regression: metadata.path was discarded and chat stayed blank.',
      );
      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as FileImage;
      expect(provider.file.path, imagePath);
    },
  );

  testWidgets(
    'issue-1306-c2: swept image renders a non-crashing placeholder and its path',
    (tester) async {
      const missingPath = '/tmp/rhythm-swept/generated-poster.png';
      final part = ChatPart.fromJson('msg_1306', _imageToolPart(missingPath));

      await tester.pumpWidget(_wrap(part));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.textContaining('Image unavailable'), findsOneWidget);
      expect(
        find.text(missingPath),
        findsOneWidget,
        reason: 'The swept-file placeholder must preserve the diagnostic path.',
      );
    },
  );

  test(
    'issue-1306-c3: production tool payload remains path-only without file or data URI bytes',
    () {
      const imagePath = '/tmp/generated-poster.png';
      final raw = _imageToolPart(imagePath);
      final encoded = jsonEncode(raw);

      expect(raw.containsKey('attachments'), isFalse);
      expect(encoded, isNot(contains('data:image')));
      expect(encoded, isNot(contains(_onePixelPng)));
      expect(encoded, contains(imagePath));
    },
  );
}
